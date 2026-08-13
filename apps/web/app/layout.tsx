import "./styles.css";
import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: { default: "ReelOps — Momentos que viram conteúdo", template: "%s · ReelOps" },
  description: "Geração automática de Reels para restaurantes a partir das câmeras da operação.",
  applicationName: "ReelOps",
  robots: { index: false, follow: false }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b241b", colorScheme: "light" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
