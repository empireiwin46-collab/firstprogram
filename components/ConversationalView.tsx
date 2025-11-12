
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Blob, LiveSession } from '@google/genai';
import { decode, decodeAudioData, encode } from '../utils/audioUtils';
import MicrophoneIcon from './icons/MicrophoneIcon';
import StopIcon from './icons/StopIcon';
import LoadingIcon from './icons/LoadingIcon';

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}
const ai = new GoogleGenAI({ apiKey: API_KEY });

type TranscriptEntry = {
    speaker: 'user' | 'model';
    text: string;
    isFinal: boolean;
};

const ConversationalView: React.FC = () => {
    const [isConnecting, setIsConnecting] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const [statusMessage, setStatusMessage] = useState('Press the microphone to start');
    const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
    const [error, setError] = useState<string | null>(null);

    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const nextStartTimeRef = useRef<number>(0);

    const cleanup = useCallback(() => {
        setIsConnecting(false);
        setIsActive(false);

        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;

        scriptProcessorRef.current?.disconnect();
        scriptProcessorRef.current = null;

        inputAudioContextRef.current?.close();
        outputAudioContextRef.current?.close();
        inputAudioContextRef.current = null;
        outputAudioContextRef.current = null;

        audioSourcesRef.current.forEach(source => source.stop());
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;

        sessionPromiseRef.current?.then(session => session.close()).catch(console.error);
        sessionPromiseRef.current = null;
    }, []);

    const handleToggleConversation = async () => {
        if (isActive) {
            cleanup();
            setStatusMessage('Session ended. Press the microphone to start again.');
            return;
        }

        setIsConnecting(true);
        setError(null);
        setTranscripts([]);
        setStatusMessage('Connecting to Gemini and requesting microphone...');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
           
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                    },
                },
                callbacks: {
                    onopen: () => {
                        setIsConnecting(false);
                        setIsActive(true);
                        setStatusMessage('Listening... Speak now.');
                        const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;

                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const l = inputData.length;
                            const int16 = new Int16Array(l);
                            for (let i = 0; i < l; i++) {
                                int16[i] = inputData[i] * 32768;
                            }
                            const pcmBlob: Blob = {
                                data: encode(new Uint8Array(int16.buffer)),
                                mimeType: 'audio/pcm;rate=16000',
                            };
                            sessionPromiseRef.current?.then((session) => {
                                session.sendRealtimeInput({ media: pcmBlob });
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                         if (message.serverContent?.inputTranscription) {
                            const { text, isFinal } = message.serverContent.inputTranscription;
                            setTranscripts(prev => {
                                const last = prev[prev.length -1];
                                if(last?.speaker === 'user' && !last.isFinal) {
                                    const updated = [...prev];
                                    updated[prev.length -1] = { ...last, text: last.text + text, isFinal };
                                    return updated;
                                }
                                return [...prev, { speaker: 'user', text, isFinal }];
                            });
                        }
                        if (message.serverContent?.outputTranscription) {
                             const { text, isFinal } = message.serverContent.outputTranscription;
                            setTranscripts(prev => {
                                const last = prev[prev.length -1];
                                if(last?.speaker === 'model' && !last.isFinal) {
                                    const updated = [...prev];
                                    updated[prev.length -1] = { ...last, text: last.text + text, isFinal };
                                    return updated;
                                }
                                return [...prev, { speaker: 'model', text, isFinal }];
                            });
                        }

                        const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio && outputAudioContextRef.current) {
                            setStatusMessage('AI is speaking...');
                            const audioContext = outputAudioContextRef.current;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                            const source = audioContext.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(audioContext.destination);
                            source.addEventListener('ended', () => {
                                audioSourcesRef.current.delete(source);
                                if (audioSourcesRef.current.size === 0) {
                                    setStatusMessage('Listening...');
                                }
                            });
                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            audioSourcesRef.current.add(source);
                        }

                        if (message.serverContent?.interrupted) {
                            audioSourcesRef.current.forEach(source => source.stop());
                            audioSourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                        }
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error(e);
                        setError('An error occurred during the session. Please try again.');
                        cleanup();
                        setStatusMessage('Error. Press microphone to retry.');
                    },
                    onclose: () => {
                       cleanup();
                       setStatusMessage('Session closed. Press microphone to start again.');
                    },
                },
            });

        } catch (e) {
            console.error(e);
            setError('Could not start the microphone. Please check permissions and try again.');
            cleanup();
            setStatusMessage('Error. Press microphone to retry.');
        }
    };

    useEffect(() => {
        // Cleanup on component unmount
        return () => cleanup();
    }, [cleanup]);

    return (
        <main className="bg-gray-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 flex flex-col" style={{minHeight: '500px'}}>
            <div
                role="log"
                aria-live="polite"
                className="flex-grow bg-gray-900/50 p-4 rounded-lg overflow-y-auto space-y-4"
            >
                {transcripts.length === 0 && <p className="text-gray-400 text-center">Conversation transcript will appear here...</p>}
                {transcripts.map((entry, index) => (
                    <div key={index} className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <p className={`max-w-xs md:max-w-md lg:max-w-lg p-3 rounded-xl ${entry.speaker === 'user' ? 'bg-blue-600' : 'bg-gray-600'}`}>
                            {entry.text}
                        </p>
                    </div>
                ))}
            </div>

            <div className="flex flex-col items-center justify-center pt-4 space-y-4">
                 <p className="text-lg text-gray-300 h-6">{statusMessage}</p>
                <button
                    onClick={handleToggleConversation}
                    disabled={isConnecting}
                    className="w-20 h-20 rounded-full flex items-center justify-center transition-colors duration-200 disabled:opacity-50 disabled:cursor-wait
                        bg-gradient-to-br from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700
                        focus:outline-none focus:ring-4 focus:ring-purple-500/50"
                    aria-label={isActive ? 'Stop conversation' : 'Start conversation'}
                >
                    {isConnecting ? <LoadingIcon /> : (isActive ? <StopIcon /> : <MicrophoneIcon />)}
                </button>
            </div>

            {error && (
                <div className="mt-4 p-4 bg-red-900/50 border border-red-500 text-red-300 rounded-lg text-center">
                    {error}
                </div>
            )}
        </main>
    );
};

export default ConversationalView;
