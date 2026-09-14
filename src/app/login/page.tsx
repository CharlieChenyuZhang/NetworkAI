import { AuthPage } from "@/components/auth-page";
export const metadata = { title: "Welcome back" };
export default function Page() {
  return <AuthPage mode="login" />;
}
