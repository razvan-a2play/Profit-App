import { useEffect, useRef } from 'react';

const SCROLL_POSITION_KEY = 'app-scroll-position';

export const useScrollRestoration = () => {
  const scrollPositionRef = useRef<number>(0);
  const restoringRef = useRef<boolean>(false);

  useEffect(() => {
    // Disable browser's automatic scroll restoration
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    // Restore scroll position on mount
    const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
    if (savedPosition) {
      const position = parseInt(savedPosition, 10);
      scrollPositionRef.current = position;
      restoringRef.current = true;
      
      // Use multiple restoration attempts to handle dynamic content
      const restore = () => {
        window.scrollTo(0, position);
      };
      
      setTimeout(restore, 0);
      setTimeout(restore, 50);
      setTimeout(restore, 150);
      setTimeout(() => {
        restore();
        restoringRef.current = false;
      }, 300);
    }

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Save scroll position when tab becomes hidden
        scrollPositionRef.current = window.scrollY;
        sessionStorage.setItem(SCROLL_POSITION_KEY, window.scrollY.toString());
      } else {
        // Restore scroll position when tab becomes visible
        const savedPosition = sessionStorage.getItem(SCROLL_POSITION_KEY);
        if (savedPosition) {
          const position = parseInt(savedPosition, 10);
          scrollPositionRef.current = position;
          restoringRef.current = true;
          
          setTimeout(() => window.scrollTo(0, position), 0);
          setTimeout(() => window.scrollTo(0, position), 50);
          setTimeout(() => {
            window.scrollTo(0, position);
            restoringRef.current = false;
          }, 150);
        }
      }
    };

    // Throttled scroll handler to avoid excessive saves
    let scrollTimeout: NodeJS.Timeout;
    const handleScroll = () => {
      if (restoringRef.current) return; // Don't save while restoring
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        scrollPositionRef.current = window.scrollY;
        sessionStorage.setItem(SCROLL_POSITION_KEY, window.scrollY.toString());
      }, 100);
    };

    // Save scroll position before unload
    const handleBeforeUnload = () => {
      sessionStorage.setItem(SCROLL_POSITION_KEY, scrollPositionRef.current.toString());
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      clearTimeout(scrollTimeout);
    };
  }, []);
};
