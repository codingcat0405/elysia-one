import { useState } from "react";
import useUserStore from "../store/user";
import { useNavigate } from "react-router";
import { api, unwrap } from "../lib/eden-client";
import { ACCESS_TOKEN_KEY } from "../constants";

const LoginPage = () => {
  const [formData, setFormData] = useState<{
    username: string;
    password: string;
  }>({
    username: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const { setUser } = useUserStore();
  const navigate = useNavigate();
  const handleLogin = async () => {
    try {
      setLoading(true);
      const data = await unwrap(api.users.login.post(formData));
      localStorage.setItem(ACCESS_TOKEN_KEY, data.jwt);
      setUser({
        id: data.user.id,
        username: data.user.username,
        role: data.user.role,
      });
      navigate("/");
    } catch (e) {
      console.log(e);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await handleLogin();
        }}
      >
        <div>
          <label>username:</label>
          <input
            type="text"
            value={formData.username}
            onChange={(e) =>
              setFormData({
                ...formData,
                username: e.target.value,
              })
            }
          />
        </div>
        <div>
          <label>password:</label>
          <input
            type="password"
            value={formData.password}
            onChange={(e) =>
              setFormData({ ...formData, password: e.target.value })
            }
          />
        </div>
        <button type="submit" disabled={loading}>
          login
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
