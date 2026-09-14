import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "sonner";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "NetworkAI | A little inspiration. Endless possibilities.",
    template: "%s | NetworkAI",
  },
  description:
    "Discover a new perspective. Share your world, explore a creative community, and bring your next idea to life with AI.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <Toaster richColors position="bottom-right" closeButton />
        </AuthProvider>
      </body>
    </html>
  );
}
