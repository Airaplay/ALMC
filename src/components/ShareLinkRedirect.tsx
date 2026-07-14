import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  legacySharePathToContentPath,
  openSharePathToContentPath,
} from "@/lib/shareLinkResolve";
import { navigateWithSharedLinkState } from "@/lib/sharedLinkNavigation";

/** /o/:kind/:id — short share links (also used when the OG gateway serves the SPA). */
export function OpenShareLinkRedirect() {
  const { kind, id } = useParams<{ kind: string; id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const target = kind && id ? openSharePathToContentPath(kind, id) : null;
    if (target) {
      navigateWithSharedLinkState(navigate, target);
    } else {
      navigate("/", { replace: true });
    }
  }, [kind, id, navigate]);

  return null;
}

/** /share/:type/:id — legacy OG gateway paths. */
export function LegacyShareLinkRedirect() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    const target = type && id ? legacySharePathToContentPath(type, id) : null;
    if (target) {
      navigateWithSharedLinkState(navigate, target);
    } else {
      navigate("/", { replace: true });
    }
  }, [type, id, navigate]);

  return null;
}
