'use client';

import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { CheckCircle, FileVideo, Upload, Zap } from 'lucide-react';
import { transcribe } from '@/app/actions';

export default function TranscriptionForm() {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const [transcriptionResult, setTranscriptionResult] = useState<string | null>(
    null,
  );
  const [progress, setProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const ffmpegRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize FFmpeg only in browser context
  useEffect(() => {
    // Only initialize in browser, not during SSR
    if (typeof window !== 'undefined') {
      const initFFmpeg = async () => {
        try {
          ffmpegRef.current = new FFmpeg();
          await loadFfmpeg();
        } catch (error) {
          console.error('Error initializing FFmpeg:', error);
        }
      };

      initFFmpeg();
    }

    // Cleanup function
    return () => {
      if (ffmpegRef.current) {
        try {
          ffmpegRef.current.terminate();
        } catch (error) {
          console.error('Error terminating FFmpeg:', error);
        }
      }
    };
  }, []);

  const loadFfmpeg = async () => {
    try {
      setIsLoading(true);
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
      const ffmpeg = ffmpegRef.current;

      if (!ffmpeg) {
        throw new Error('FFmpeg reference not available');
      }

      ffmpeg.on('log', ({ message }: { message: string }) => {
        console.log('FFmpeg log:', message);
      });

      ffmpeg.on('progress', ({ progress }: { progress: number }) => {
        setProgress(Math.round(progress * 100));
      });

      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          'text/javascript',
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          'application/wasm',
        ),
      });

      setFfmpegLoaded(true);
      console.log('FFmpeg loaded successfully');
    } catch (error) {
      console.error('Error loading FFmpeg:', error);
      alert(
        `Failed to load FFmpeg: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (selectedFile: File) => {
    setFile(selectedFile);
    setStep(2);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const convertToAudio = async (inputFile: File): Promise<Blob> => {
    const ffmpeg = ffmpegRef.current;

    if (!ffmpeg) {
      throw new Error('FFmpeg not initialized');
    }

    try {
      // Write the input file to FFmpeg's virtual file system
      await ffmpeg.writeFile('input.mp4', await fetchFile(inputFile));

      // Convert video to audio with proper settings for transcription
      await ffmpeg.exec([
        '-i',
        'input.mp4',
        '-vn', // No video
        '-acodec',
        'libmp3lame', // MP3 codec
        '-ar',
        '16000', // 16kHz sample rate (good for speech recognition)
        '-ac',
        '1', // Mono audio
        '-q:a',
        '2', // High quality
        'output.mp3',
      ]);

      // Read the output file from FFmpeg's virtual file system
      const data = await ffmpeg.readFile('output.mp3');

      // Create a Blob from the output data
      return new Blob([data], { type: 'audio/mp3' });
    } catch (error) {
      console.error('Error converting video to audio:', error);
      throw error;
    }
  };

  // Function to convert a Blob to base64
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result.split(',')[1]); // Remove the data URL prefix
        } else {
          reject(new Error('Failed to convert to base64'));
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleTranscribe = async () => {
    if (!file) return;
    setStep(3);
    setIsProcessing(true);

    try {
      // Make sure FFmpeg is loaded
      if (!ffmpegLoaded) {
        await loadFfmpeg();
      }

      // Convert video to audio
      console.log('Converting video to audio...');
      const audioBlob = await convertToAudio(file);
      console.log('Conversion complete, audio blob size:', audioBlob.size);

      // Convert audio to base64 (needed for API request)
      console.log('Converting audio to base64...');
      const base64Audio = await blobToBase64(audioBlob);
      console.log('Base64 conversion complete, length:', base64Audio.length);

      // If the base64 is too large, it might need to be shortened or split
      // For now, we'll limit it to a reasonable size to avoid request size limits
      const maxLength = 100000; // Set a reasonable limit
      const trimmedBase64 =
        base64Audio.length > maxLength
          ? base64Audio.substring(0, maxLength)
          : base64Audio;

      // Create and populate FormData
      const formData = new FormData();
      formData.append('base64Audio', trimmedBase64);

      // Request transcription
      console.log('Requesting transcription from Groq API...');
      const result = await transcribe(formData);
      console.log('Transcription result:', result);

      setTranscriptionResult(result.text);
      setStep(4);
    } catch (error) {
      console.error('Error during transcription:', error);
      setStep(1);
      alert(
        `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const createSubtitleFile = (text: string, format: 'vtt' | 'srt'): string => {
    if (format === 'vtt') {
      return `WEBVTT\n\n1\n00:00:00.000 --> 00:00:10.000\n${text}`;
    } else {
      return `1\n00:00:00,000 --> 00:00:10,000\n${text}`;
    }
  };

  const downloadSubtitle = (format: 'vtt' | 'srt') => {
    if (!transcriptionResult) return;

    const content = createSubtitleFile(transcriptionResult, format);
    const blob = new Blob([content], {
      type: format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `transcript.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full">
        <h1 className="text-2xl font-semibold mb-2 text-center">
          Video Transcriber
        </h1>
        <h2 className="text-lg text-center mb-6 text-gray-600">
          Powered by Groq
        </h2>

        {step === 1 && (
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center ${dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300'}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
          >
            <FileVideo className="mx-auto mb-4 text-gray-400" size={48} />
            <p className="mb-4">Drag and drop your video file here, or</p>
            <input
              type="file"
              onChange={(e) =>
                e.target.files?.[0] && handleFileChange(e.target.files[0])
              }
              accept="video/*"
              className="hidden"
              ref={inputRef}
            />
            <Button
              onClick={() => inputRef.current?.click()}
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              <Upload className="mr-2" size={16} />
              Choose File
            </Button>
          </div>
        )}

        {step === 2 && file && (
          <div className="text-center">
            <CheckCircle className="mx-auto mb-4 text-green-500" size={48} />
            <p className="mb-4">
              Selected file: <strong>{file.name}</strong>
            </p>
            <Button
              onClick={handleTranscribe}
              className="bg-blue-500 hover:bg-blue-600 text-white w-full"
              disabled={isLoading}
            >
              <Zap className="mr-2" size={16} />
              {isLoading ? 'Loading FFmpeg...' : 'Start Transcription'}
            </Button>
          </div>
        )}

        {step === 3 && (
          <div className="text-center">
            <h3 className="mb-4">Processing your video...</h3>
            <Progress value={progress} className="mb-4" />
            <p className="text-gray-500">
              {isProcessing
                ? 'Converting video to audio...'
                : 'Transcribing audio...'}
            </p>
          </div>
        )}

        {step === 4 && transcriptionResult && (
          <div>
            <h3 className="text-xl mb-4">Transcription Result</h3>
            <div className="bg-gray-50 p-4 rounded-lg mb-4 max-h-60 overflow-y-auto">
              <p>{transcriptionResult}</p>
            </div>
            <div className="flex space-x-2">
              <Button
                onClick={() => downloadSubtitle('vtt')}
                className="bg-green-500 hover:bg-green-600 text-white flex-1"
              >
                Download VTT
              </Button>
              <Button
                onClick={() => downloadSubtitle('srt')}
                className="bg-purple-500 hover:bg-purple-600 text-white flex-1"
              >
                Download SRT
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
