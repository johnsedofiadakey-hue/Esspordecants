import { useEffect, useState } from "react";

const event = "esspor-admin-navigate";

export function navigate(path: string) {
  if (path === location.pathname + location.search) return;
  history.pushState(null, "", path);
  window.dispatchEvent(new Event(event));
  window.scrollTo(0, 0);
}

export function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const update = () => setPath(location.pathname);
    window.addEventListener("popstate", update);
    window.addEventListener(event, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(event, update);
    };
  }, []);
  return path;
}
