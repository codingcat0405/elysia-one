import { Outlet, useLocation, useNavigate } from "react-router";
import { useEffect } from "react";
import { ACCESS_TOKEN_KEY } from "../constants";

const AuthedLayout = () => {
  const navigate = useNavigate();
  const pathname = useLocation();

  useEffect(() => {
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    if (!accessToken) {
      navigate("/login");
    }
  }, [pathname.pathname, navigate]);
  return (
    <main>
      <Outlet />
    </main>
  );
};

export default AuthedLayout;
