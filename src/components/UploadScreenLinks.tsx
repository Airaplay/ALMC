import { useNavigate } from 'react-router-dom';
import { Music, Disc3 } from 'lucide-react';

export default function UploadScreenLinks() {
  const navigate = useNavigate();

  return (
    <div className="p-4 space-y-3">
      <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg mb-3">
        Quick Upload
      </h3>

      <button
        onClick={() => navigate('/upload/single')}
        className="w-full flex items-center gap-3 p-4 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#3ba208] text-white rounded-xl transition-all duration-200 shadow-lg"
      >
        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
          <Music className="w-5 h-5" />
        </div>
        <div className="flex-1 text-left">
          <p className="font-['Inter',sans-serif] font-bold text-sm">Upload Single Track</p>
          <p className="font-['Inter',sans-serif] text-white/80 text-xs">MP3, WAV supported</p>
        </div>
      </button>

      <button
        onClick={() => navigate('/upload/album')}
        className="w-full flex items-center gap-3 p-4 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#3ba208] text-white rounded-xl transition-all duration-200 shadow-lg"
      >
        <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
          <Disc3 className="w-5 h-5" />
        </div>
        <div className="flex-1 text-left">
          <p className="font-['Inter',sans-serif] font-bold text-sm">Upload Album</p>
          <p className="font-['Inter',sans-serif] text-white/80 text-xs">Multiple tracks</p>
        </div>
      </button>
    </div>
  );
}
