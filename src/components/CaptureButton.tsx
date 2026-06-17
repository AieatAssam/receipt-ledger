import { useRef, useState, useCallback, useEffect } from 'react';
import { Camera, Upload, X } from 'lucide-react';
import { cn } from '../lib/utils';

interface CaptureButtonProps {
  onCapture: (image: ImageBitmap) => void;
  className?: string;
}

export default function CaptureButton({ onCapture, className }: CaptureButtonProps) {
  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setShowCamera(true);
    } catch {
      // Fall back to file upload if camera unavailable
      fileInputRef.current?.click();
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setShowCamera(false);
  }, []);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);

    createImageBitmap(canvas).then(bitmap => {
      onCapture(bitmap);
      stopCamera();
    });
  }, [onCapture, stopCamera]);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    createImageBitmap(file).then(bitmap => {
      onCapture(bitmap);
    });

    // Reset so the same file can be selected again
    e.target.value = '';
  }, [onCapture]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <>
      <div className={cn('flex gap-3', className)}>
        <button
          type="button"
          onClick={startCamera}
          className="flex-1 flex items-center justify-center gap-2 h-14 bg-primary text-primary-foreground rounded-xl font-medium transition-opacity hover:opacity-90 active:opacity-75 min-h-[44px]"
        >
          <Camera className="w-5 h-5" />
          <span className="text-sm">Take Photo</span>
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 h-14 px-5 bg-secondary text-secondary-foreground rounded-xl font-medium transition-opacity hover:opacity-90 active:opacity-75 min-h-[44px]"
        >
          <Upload className="w-5 h-5" />
          <span className="text-sm">Upload</span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />
      </div>

      {/* Camera overlay */}
      {showCamera && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="flex-1 relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="absolute inset-0 w-full h-full object-cover"
            />
          </div>
          <div className="flex items-center justify-center gap-6 p-6 pb-safe bg-black">
            <button
              type="button"
              onClick={stopCamera}
              className="flex items-center justify-center h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/20 min-h-[44px] min-w-[44px]"
            >
              <X className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={takePhoto}
              className="flex items-center justify-center h-16 w-16 rounded-full bg-white border-4 border-white/30 min-h-[44px] min-w-[44px]"
            />
          </div>
        </div>
      )}
    </>
  );
}
