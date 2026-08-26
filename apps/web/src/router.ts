import { createBrowserRouter } from "react-router";
import AuthedLayout from "./layout/AuthedLayout";
import HomePage from "./page/HomePage";
import RegisterPage from "./page/RegisterPage";
import LoginPage from "./page/LoginPage";


const router = createBrowserRouter([
  {
    Component: AuthedLayout,
    children: [
      {
        path: "/",
        Component: HomePage,
      },
    ],
  },
  {
    path: "/login",
    Component: LoginPage,
  },
  {
    path: "/register",
    Component: RegisterPage,
  },
]);

export default router;