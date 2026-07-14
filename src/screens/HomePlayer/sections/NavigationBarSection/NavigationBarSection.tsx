import { Home, Search, Plus, Library, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../../../contexts/AuthContext";
import { useState } from "react";
import { AuthModal } from "../../../../components/AuthModal";

export const NavigationBarSection = (): JSX.Element => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  const navItems = [
    { icon: Home, label: "Home", id: "home", path: "/", requiresAuth: false },
    { icon: Search, label: "Explore", id: "explore", path: "/explore", requiresAuth: false },
    { icon: Plus, label: "Create", id: "create", path: "/create", requiresAuth: true },
    { icon: Library, label: "Library", id: "library", path: "/library", requiresAuth: true },
    { icon: User, label: "Profile", id: "profile", path: "/profile", requiresAuth: true },
  ];

  const activeTab = navItems.findIndex(item => item.path === location.pathname);
  const currentActiveTab = activeTab >= 0 ? activeTab : 0;

  const handleTabClick = (index: number) => {
    const item = navItems[index];

    // Check if the button requires authentication
    if (item.requiresAuth && !isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    navigate(item.path);
  };

  return (
    <>
      <nav className="fixed bottom-0 left-0 right-0 z-[100] bg-black/90 backdrop-blur-xl border-t border-white/10 shadow-2xl mobile-nav-bar">
        <div className="flex justify-center w-full">
          <div className="w-full max-w-[390px]">
            <div className="flex items-center justify-between h-[72px] px-4 py-2">
              {navItems.map((item, index) => {
                const IconComponent = item.icon;
                const isActive = currentActiveTab === index;
                const isDisabled = item.requiresAuth && !isAuthenticated;

                return (
                  <button
                    key={item.id}
                    onClick={() => handleTabClick(index)}
                    aria-label={item.label}
                    aria-current={isActive ? 'page' : undefined}
                    disabled={isDisabled}
                    className={`
                      relative flex items-center justify-center gap-2
                      transition-all duration-300 ease-out
                      focus-visible:outline-none focus-visible:ring-2
                      focus-visible:ring-[#309605] focus-visible:ring-offset-2
                      focus-visible:ring-offset-black
                      ${isDisabled ? "opacity-40 cursor-not-allowed" : ""}
                      ${isActive
                        ? "h-11 px-4 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-full shadow-lg shadow-[#309605]/25"
                        : `h-11 w-11 rounded-full ${!isDisabled ? "hover:bg-white/10 active:scale-95" : ""}`
                      }
                    `}
                  >
                    <IconComponent
                      className={`
                        flex-shrink-0 transition-all duration-300
                        ${isActive
                          ? "w-[18px] h-[18px] text-white"
                          : "w-5 h-5 text-white/50 group-hover:text-white/70"
                        }
                      `}
                      strokeWidth={isActive ? 2.5 : 1.75}
                    />

                    {isActive && (
                      <span className="font-semibold text-[13px] text-white whitespace-nowrap">
                        {item.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </nav>

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}
    </>
  );
};
