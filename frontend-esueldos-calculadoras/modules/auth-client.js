(function () {
  const TOKEN_KEY = "esueldos.authToken";

  function getStoredToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch (error) {
      return "";
    }
  }

  function storeToken(token) {
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch (error) {
      // Storage can be unavailable in private/file contexts.
    }
  }

  function clearToken() {
    storeToken("");
  }

  function getStoredUser() {
    try {
      return JSON.parse(window.localStorage.getItem(`${TOKEN_KEY}.user`) || "null");
    } catch (error) {
      return null;
    }
  }

  function storeUser(user) {
    try {
      if (user) window.localStorage.setItem(`${TOKEN_KEY}.user`, JSON.stringify(user));
      else window.localStorage.removeItem(`${TOKEN_KEY}.user`);
    } catch (error) {
      // Storage can be unavailable in private/file contexts.
    }
  }

  window.eSueldosAuth = {
    clearToken,
    getStoredToken,
    getStoredUser,
    storeUser,
    storeToken
  };

  if (window.eSueldosApi?.createApiClient) {
    window.eSueldosApiClient = window.eSueldosApi.createApiClient({
      tokenProvider: getStoredToken
    });
  }
})();
