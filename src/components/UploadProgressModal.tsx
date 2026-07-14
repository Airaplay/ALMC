import React, { useState, useEffect } from 'react';
import { X, Minimize2, Upload, CheckCircle, AlertCircle, Music, Video, Album } from 'lucide-react';
import { useUpload } from '../contexts/UploadContext';

export default function UploadProgressModal() {
  const { uploads, removeUpload, isModalVisible, setModalVisible } = useUpload();
  const [isMinimized, setIsMinimized] = useState(false);

  const activeUploads = uploads.filter(u => u.status === 'uploading' || u.status === 'processing');
  const completedUploads = uploads.filter(u => u.status === 'completed');
  const errorUploads = uploads.filter(u => u.status === 'error');

  useEffect(() => {
    if (uploads.length > 0 && activeUploads.length === 0 && errorUploads.length === 0 && completedUploads.length > 0) {
      const timer = setTimeout(() => {
        uploads.forEach(u => removeUpload(u.id));
        setModalVisible(false);
        setIsMinimized(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [uploads.length, activeUploads.length, errorUploads.length, completedUploads.length, uploads, removeUpload, setModalVisible]);

  if (!isModalVisible || uploads.length === 0) {
    return null;
  }

  const getIcon = (type: string) => {
    switch (type) {
      case 'single':
        return <Music className="w-5 h-5 text-white/80" />;
      case 'video':
        return <Video className="w-5 h-5 text-white/80" />;
      case 'album':
        return <Album className="w-5 h-5 text-white/80" />;
      default:
        return <Upload className="w-5 h-5 text-white/80" />;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-white" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-400" />;
      default:
        return <Upload className="w-4 h-4 text-white animate-pulse" />;
    }
  };

  if (isMinimized) {
    return (
      <div className="fixed bottom-24 right-4 z-[9999]">
        <div
          onClick={() => setIsMinimized(false)}
          className="bg-gradient-to-r from-white to-white/80 text-black pl-4 pr-2 py-3 rounded-full shadow-lg cursor-pointer hover:shadow-xl transition-all flex items-center gap-3"
        >
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 animate-pulse" />
            <span className="font-medium text-sm">{activeUploads.length} uploading...</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setModalVisible(false);
            }}
            className="p-1.5 hover:bg-white/20 rounded-full transition-colors"
            title="Close (uploads will continue)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-end sm:items-center justify-center z-[9999]">
      <div className="bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[85vh] overflow-hidden border border-white/10">
        {/* Header */}
        <div className="bg-white/5 backdrop-blur-sm border-b border-white/10 p-4 sticky top-0 z-10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-r from-white to-white/80 flex items-center justify-center">
                <Upload className="w-5 h-5 text-black" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Upload Progress</h3>
                <p className="text-xs text-white/60">
                  {activeUploads.length > 0 ? `${activeUploads.length} active upload${activeUploads.length > 1 ? 's' : ''}` : 'Complete'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {activeUploads.length > 0 && (
                <button
                  onClick={() => setIsMinimized(true)}
                  className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                  title="Minimize"
                >
                  <Minimize2 className="w-5 h-5 text-white/80" />
                </button>
              )}
              <button
                onClick={() => setModalVisible(false)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                title="Close"
              >
                <X className="w-5 h-5 text-white/80" />
              </button>
            </div>
          </div>
        </div>

        {/* Info Banner - Only show when actively uploading */}
        {activeUploads.length > 0 && (
          <div className="bg-white/5 border-l-2 border-white mx-4 mt-4 p-3 rounded-lg">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-white flex-shrink-0 mt-0.5" />
              <p className="text-xs text-white/70 leading-relaxed">
                You can safely close this window. Your uploads will continue in the background.
              </p>
            </div>
          </div>
        )}

        {/* Upload Items */}
        <div className="p-4 space-y-3 max-h-[calc(85vh-180px)] overflow-y-auto">
          {uploads.map((upload) => (
            <div
              key={upload.id}
              className="bg-white/5 backdrop-blur-sm rounded-xl p-4 border border-white/10"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                  {getIcon(upload.type)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h4 className="font-medium text-white text-sm truncate">{upload.title}</h4>
                    {getStatusIcon(upload.status)}
                  </div>

                  {upload.status === 'uploading' && (
                    <div className="space-y-2">
                      <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-white to-white/80 h-full transition-all duration-300 ease-out"
                          style={{ width: `${upload.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-white/60 font-medium">{upload.progress}% uploaded</p>
                    </div>
                  )}

                  {upload.status === 'processing' && (
                    <div className="space-y-2">
                      <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-gradient-to-r from-white to-white/80 h-full w-full animate-pulse" />
                      </div>
                      <p className="text-xs text-white/60 font-medium">Processing...</p>
                    </div>
                  )}

                  {upload.status === 'completed' && (
                    <div className="flex items-center gap-2">
                      <div className="w-full bg-white/20 rounded-full h-1.5 overflow-hidden">
                        <div className="bg-gradient-to-r from-white to-white/80 h-full w-full" />
                      </div>
                    </div>
                  )}

                  {upload.status === 'error' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        <p className="text-xs text-red-400 font-medium">Upload failed</p>
                      </div>
                      {upload.error && (
                        <p className="text-xs text-white/50 leading-relaxed">{upload.error}</p>
                      )}
                      <button
                        onClick={() => removeUpload(upload.id)}
                        className="text-xs text-white/60 hover:text-white underline transition-colors"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Success Footer */}
        {completedUploads.length > 0 && activeUploads.length === 0 && errorUploads.length === 0 && (
          <div className="p-4 bg-gradient-to-r from-white/10 to-white/5 border-t border-white/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-white" />
                <p className="text-white text-sm font-medium">All uploads completed!</p>
              </div>
              <button
                onClick={() => {
                  uploads.forEach(u => removeUpload(u.id));
                  setModalVisible(false);
                }}
                className="text-xs text-white hover:text-white/80 underline transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
