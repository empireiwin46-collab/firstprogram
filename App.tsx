
import React, { useState, useRef, useCallback } from 'react';
import { summarizeArticle, generateSpeech } from './services/geminiService';
import { decode, decodeAudioData } from './utils/audioUtils';
import PlayIcon from './components/icons/PlayIcon';
import PauseIcon from './components/icons/PauseIcon';
import LoadingIcon from './components/icons/LoadingIcon';
import ConversationalView from './components/ConversationalView';

const App: React.FC = () => {
    const [activeView, setActiveView] = useState<'summarizer' | 'conversation'>('summarizer');

    // State for Summarizer view
    const [articleText, setArticleText] = useState<string>('');
    const [summaryText, setSummaryText] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [isPlaying, setIsPlaying] = useState<boolean>(false);

    const audioDataRef = useRef<string | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

    const handleGenerateSummary = async () => {
        if (!articleText.trim()) {
            setError('Please paste a news article first.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSummaryText('');
        audioDataRef.current = null;
        if (isPlaying) {
            handleTogglePlayback(); // Stop any currently playing audio
        }

        try {
            const summary = await summarizeArticle(articleText);
            setSummaryText(summary);

            const audioData = await generateSpeech(summary);
            audioDataRef.current = audioData;

        } catch (e) {
            console.error(e);
            setError('Failed to generate summary or audio. Please check your API key and try again.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleTogglePlayback = useCallback(async () => {
        if (isPlaying) {
            if (audioSourceRef.current) {
                audioSourceRef.current.stop();
            }
            setIsPlaying(false);
            return;
        }

        if (!audioDataRef.current) return;

        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        }

        const audioContext = audioContextRef.current;
        
        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        try {
            const decodedData = decode(audioDataRef.current);
            const audioBuffer = await decodeAudioData(decodedData, audioContext, 24000, 1);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            
            source.onended = () => {
                setIsPlaying(false);
                audioSourceRef.current = null;
            };

            source.start();
            audioSourceRef.current = source;
            setIsPlaying(true);
        } catch(e) {
            console.error("Error playing audio: ", e);
            setError("Could not play the generated audio.");
        }
    }, [isPlaying]);

    return (
        <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 sm:p-6 lg:p-8 font-sans">
            <div className="w-full max-w-3xl mx-auto">
                <header className="text-center mb-8">
                    <h1 className="text-4xl sm:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                        AI Companion
                    </h1>
                    <p className="mt-2 text-lg text-gray-400">
                        Get news summaries or have a live conversation.
                    </p>
                </header>

                <div className="flex justify-center border-b border-gray-700 mb-6">
                    <button
                        onClick={() => setActiveView('summarizer')}
                        className={`px-6 py-3 text-lg font-medium transition-colors duration-200 ${
                            activeView === 'summarizer'
                                ? 'border-b-2 border-purple-500 text-white'
                                : 'text-gray-400 hover:text-white'
                        }`}
                        aria-current={activeView === 'summarizer' ? 'page' : undefined}
                    >
                        Summarizer
                    </button>
                    <button
                        onClick={() => setActiveView('conversation')}
                        className={`px-6 py-3 text-lg font-medium transition-colors duration-200 ${
                            activeView === 'conversation'
                                ? 'border-b-2 border-purple-500 text-white'
                                : 'text-gray-400 hover:text-white'
                        }`}
                        aria-current={activeView === 'conversation' ? 'page' : undefined}
                    >
                        Live Conversation
                    </button>
                </div>

                {activeView === 'summarizer' && (
                     <main className="bg-gray-800 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6">
                        <div className="flex flex-col space-y-4">
                            <label htmlFor="article-input" className="text-lg font-semibold text-gray-300">
                                Paste your article here
                            </label>
                            <textarea
                                id="article-input"
                                rows={10}
                                value={articleText}
                                onChange={(e) => setArticleText(e.target.value)}
                                placeholder="Start by pasting the full text of a news article..."
                                className="w-full p-4 bg-gray-900 border-2 border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors duration-200 resize-y text-gray-200"
                            />
                        </div>

                        <div className="flex justify-center">
                            <button
                                onClick={handleGenerateSummary}
                                disabled={isLoading}
                                className="flex items-center justify-center w-full sm:w-auto px-8 py-3 text-lg font-bold text-white bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg hover:from-blue-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transform hover:scale-105 transition-transform duration-200 shadow-lg"
                            >
                                {isLoading ? (
                                    <>
                                        <LoadingIcon />
                                        Generating...
                                    </>
                                ) : (
                                    'Generate Audio Summary'
                                )}
                            </button>
                        </div>

                        {error && (
                            <div className="p-4 bg-red-900/50 border border-red-500 text-red-300 rounded-lg text-center">
                                {error}
                            </div>
                        )}

                        {summaryText && !isLoading && (
                            <div className="bg-gray-900/50 p-6 rounded-lg space-y-4 animate-fade-in">
                                <h2 className="text-2xl font-bold text-blue-300">Your Summary</h2>
                                <div className="flex items-center space-x-4">
                                    <button
                                        onClick={handleTogglePlayback}
                                        className="p-3 bg-blue-600 rounded-full hover:bg-blue-700 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-blue-500"
                                    >
                                        <span className="sr-only">{isPlaying ? 'Pause' : 'Play'}</span>
                                        {isPlaying ? <PauseIcon /> : <PlayIcon />}
                                    </button>
                                    <p className="text-gray-300 flex-1">{summaryText}</p>
                                </div>
                            </div>
                        )}
                    </main>
                )}

                {activeView === 'conversation' && <ConversationalView />}

                <footer className="text-center mt-8 text-gray-500 text-sm">
                    <p>Powered by Google Gemini</p>
                </footer>
            </div>
        </div>
    );
};

export default App;
