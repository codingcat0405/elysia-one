import { RouterProvider } from "react-router";
import router from "./router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, unwrap } from "./lib/eden-client";
import useUserStore from "./store/user";
import { ACCESS_TOKEN_KEY } from "./constants";
import { useEffect } from "react";

const queryClient = new QueryClient();
function App() {
  const { setUser, clearUser } = useUserStore();
  const handleRefresh = async () => {
    try {
      const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
      if (!accessToken) return;
      const data = await unwrap(api.users.me.get());
      setUser({
        id: data.id,
        role: data.role,
        username: data.username,
      });
    } catch (err) {
      console.log(err);
      clearUser();
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      window.location.href = "/login";
    }
  };
  useEffect(() => {
    handleRefresh()
  }, [])
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

export default App;
