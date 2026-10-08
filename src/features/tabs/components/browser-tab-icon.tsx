import { useState } from "react";
import { GlobeIcon } from "@/ui/icons";

interface BrowserTabIconProps {
  favicon?: string;
}

export function BrowserTabIcon({ favicon }: BrowserTabIconProps) {
  const [failedFavicon, setFailedFavicon] = useState<string | null>(null);

  if (!favicon || failedFavicon === favicon) {
    return <GlobeIcon className="text-subtle-foreground" />;
  }

  return (
    <img
      src={favicon}
      alt=""
      className="size-3 object-contain"
      referrerPolicy="no-referrer"
      onError={() => setFailedFavicon(favicon)}
    />
  );
}
