"use client";
import { useEffect } from "react";

const safe = (value: string) => JSON.stringify(value).replace(/</g, "\\u003c");

export function MarketingEvents({
  pageId, productId, metaPixelId, gaId, gtmId,
}: { pageId: string; productId: string; metaPixelId: string; gaId: string; gtmId: string }) {
  useEffect(() => {
    let visitorId = "anonymous";
    try {
      visitorId = localStorage.getItem("landiq_visitor") ?? crypto.randomUUID();
      localStorage.setItem("landiq_visitor", visitorId);
    } catch { /* ignore */ }
    fetch("/api/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "page_view", visitorId, pageId, productId, metadata: { path: location.pathname } }),
    }).catch(() => undefined);
    fetch("/api/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "view_content", visitorId, pageId, productId }),
    }).catch(() => undefined);

    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const link = target.closest("a[href^='#order'], button[data-lp-cta]");
      if (link) {
        fetch("/api/events", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "cta_click", visitorId, pageId, productId }),
        }).catch(() => undefined);
        if (metaPixelId && typeof window.fbq === "function") window.fbq("track", "InitiateCheckout", { content_ids: [productId] });
        if (gaId && typeof window.gtag === "function") window.gtag("event", "initiate_checkout", { value: 1 });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [pageId, productId, metaPixelId, gaId]);

  return (
    <>
      {gtmId && <script dangerouslySetInnerHTML={{ __html: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${safe(gtmId)});` }} />}
      {metaPixelId && <script dangerouslySetInnerHTML={{ __html: `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${safe(metaPixelId)});fbq('track','PageView');` }} />}
      {gaId && <script async src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} />}
      {gaId && <script dangerouslySetInnerHTML={{ __html: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${safe(gaId)});` }} />}
    </>
  );
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  }
}
