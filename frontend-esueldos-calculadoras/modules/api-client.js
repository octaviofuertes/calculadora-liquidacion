(function () {
  function resolveApiBase(locationRef = window.location) {
    if (typeof window.ESUELDOS_API_URL === "string") {
      return window.ESUELDOS_API_URL.replace(/\/$/, "");
    }
    if (locationRef.protocol === "file:") {
      return "http://localhost:4100";
    }
    if (["localhost", "127.0.0.1"].includes(locationRef.hostname) && locationRef.port !== "4100") {
      return `${locationRef.protocol}//${locationRef.hostname}:4100`;
    }
    return "";
  }

  function createApiClient({ baseUrl = resolveApiBase(), tokenProvider = null } = {}) {
    function url(path) {
      return `${baseUrl}${path}`;
    }

    async function json(path, options = {}) {
      const headers = new Headers(options.headers || {});
      if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
        headers.set("Content-Type", "application/json");
      }
      const token = tokenProvider?.();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch(url(path), { ...options, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      return payload;
    }

    return { baseUrl, url, json };
  }

  window.eSueldosApi = {
    createApiClient,
    resolveApiBase
  };
})();
