import { useNavigate } from "react-router";
import { ACCESS_TOKEN_KEY } from "../constants";
import useUserStore from "../store/user";

const HomePage = () => {
  const { user, clearUser } = useUserStore();
  const navigate = useNavigate();

  return (
    <div>
      Logged as ID: {user.id}, username: {user.username}
      <button
        onClick={() => {
          localStorage.removeItem(ACCESS_TOKEN_KEY);
          clearUser();
          navigate("/login");
        }}
      >
        logout
      </button>
    </div>
  );
};

export default HomePage;
