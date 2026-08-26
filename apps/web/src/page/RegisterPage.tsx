import { useState } from "react";
import { api, unwrap } from "../lib/eden-client";
import { ACCESS_TOKEN_KEY } from "../constants";
import useUserStore from "../store/user";
import { useNavigate } from "react-router";

const RegisterPage = () => {
  const [data, setData] = useState<{
    username: string;
    password: string;
  }>({
    username: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const { setUser } = useUserStore();
  const navigate = useNavigate();
  const handleRegister = async () => {
    try {
      setLoading(true);
      await unwrap(api.users.register.post(data));
      //logged user in when register success
      const loginRes = await unwrap(api.users.login.post(data));
      localStorage.setItem(ACCESS_TOKEN_KEY, loginRes.jwt);
      setUser({
        id: loginRes.user.id,
        username: loginRes.user.username,
        role: loginRes.user.role,
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
          await handleRegister();
        }}
      >
        <div>
          <label>username:</label>
          <input
            type="text"
            value={data.username}
            onChange={(e) =>
              setData({
                ...data,
                username: e.target.value,
              })
            }
          />
        </div>
        <div>
          <label>password:</label>
          <input
            type="password"
            value={data.password}
            onChange={(e) => setData({ ...data, password: e.target.value })}
          />
        </div>
        <button type="submit" disabled={loading}>
          register
        </button>
      </form>
    </div>
  );
};

export default RegisterPage;
