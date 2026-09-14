import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { Toaster } from "sonner";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "NetworkAI | Discover and share",
    template: "%s | NetworkAI",
  },
  description:
    "Discover community posts, share images and videos, and create with AI.",
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
