import { Music, Album, Video } from 'lucide-react';
import { Card, CardContent } from './ui/card';

interface CreatorUploadOptionsProps {
  onSelectUploadType: (_uploadType: string) => void;
}

export const CreatorUploadOptions: React.FC<CreatorUploadOptionsProps> = ({
  onSelectUploadType,
}) => {
  const uploadTypes = [
    {
      id: 'single',
      title: 'Single',
      description: 'Upload a single track (MP3)',
      icon: Music,
    },
    {
      id: 'album',
      title: 'Album/EP',
      description: 'Upload multiple tracks as an album',
      icon: Album,
    },
    {
      id: 'video',
      title: 'Video',
      description: 'Upload a music video (MP4)',
      icon: Video,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="mb-4">
        <h2 className="font-bold text-white text-base mb-1.5">
          What would you like to upload?
        </h2>
        <p className="text-gray-400 text-sm leading-relaxed">
          Choose the type of content you want to share
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {uploadTypes.map((type) => {
          const IconComponent = type.icon;

          return (
            <Card
              key={type.id}
              onClick={() => onSelectUploadType(type.id)}
              className="bg-gradient-to-br from-white/10 to-white/5 backdrop-blur-sm border border-white/10 active:bg-white/[0.12] active:scale-[0.98] transition-all duration-200 cursor-pointer group min-h-[72px]"
            >
              <CardContent className="p-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center group-active:bg-white/20 transition-colors flex-shrink-0">
                    <IconComponent className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white text-sm mb-0.5">
                      {type.title}
                    </h3>
                    <p className="text-gray-400 text-xs leading-relaxed">
                      {type.description}
                    </p>
                  </div>
                  <div className="w-5 h-5 border-2 border-white/30 rounded-full group-active:border-white/70 transition-colors flex-shrink-0"></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
};