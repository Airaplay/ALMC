import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import SingleUploadForm from '../../components/SingleUploadForm';

function SingleUploadScreen() {
  const navigate = useNavigate();
  const [isCreator, setIsCreator] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkCreatorStatus();
  }, []);

  const checkCreatorStatus = async () => {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        navigate('/');
        return;
      }

      const { data: artistProfile, error: profileError } = await supabase
        .from('artist_profiles')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        console.error('Error checking creator status:', profileError);
        setIsCreator(false);
        setIsLoading(false);
        return;
      }

      if (!artistProfile) {
        setIsCreator(false);
      } else {
        setIsCreator(true);
      }

      setIsLoading(false);
    } catch (error) {
      console.error('Error in checkCreatorStatus:', error);
      setIsCreator(false);
      setIsLoading(false);
    }
  };

  const handleUploadSuccess = () => {
    navigate('/profile');
  };

  const handleClose = () => {
    navigate(-1);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#e6f7f1] via-white to-[#d9f3ea] flex items-center justify-center">
        <div className="text-center">
          <LoadingLogo variant="pulse" size={48} />
          <p className="font-['Inter',sans-serif] text-gray-600">Verifying access...</p>
        </div>
      </div>
    );
  }

  if (!isCreator) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#e6f7f1] via-white to-[#d9f3ea]">
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto">
            <button
              onClick={handleClose}
              className="flex items-center gap-2 text-gray-600 hover:text-[#309605] mb-6 transition-colors duration-200"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-['Inter',sans-serif] font-medium">Go Back</span>
            </button>

            <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="font-['Inter',sans-serif] font-bold text-gray-900 text-2xl mb-3">
                Creator Access Required
              </h2>
              <p className="font-['Inter',sans-serif] text-gray-600 mb-6">
                This feature is only available to registered creators. Please register as a creator to upload music.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => navigate('/artist-registration')}
                  className="px-6 py-3 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#3ba208] text-white rounded-xl font-['Inter',sans-serif] font-medium transition-all duration-200 shadow-lg shadow-[#309605]/25"
                >
                  Become a Creator
                </button>
                <button
                  onClick={handleClose}
                  className="px-6 py-3 bg-white border-2 border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400 rounded-xl font-['Inter',sans-serif] font-medium transition-all duration-200"
                >
                  Go Back
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#e6f7f1] via-white to-[#d9f3ea]">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <button
            onClick={handleClose}
            className="flex items-center gap-2 text-gray-600 hover:text-[#309605] mb-6 transition-colors duration-200"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-['Inter',sans-serif] font-medium">Go Back</span>
          </button>

          <div className="bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="p-6 pb-2">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground mb-3">
                Single Upload
              </p>
              <h1 className="text-4xl xl:text-5xl font-black tracking-tight text-foreground leading-none">
                Release your track
              </h1>
            </div>

            <div className="p-6">
              <SingleUploadForm
                onClose={handleClose}
                onSuccess={handleUploadSuccess}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SingleUploadScreen;
