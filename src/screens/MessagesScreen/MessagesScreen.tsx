import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const MessagesScreen = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] content-with-nav">
      <div className="px-5 pt-6 pb-24">
        <div className="flex items-center mb-6">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-white/80 hover:text-white transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold ml-3">Messages</h1>
        </div>

        <div className="text-center py-12">
          <p className="text-white/60">No messages yet</p>
        </div>
      </div>
    </div>
  );
};
