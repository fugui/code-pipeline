import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// 拦截全局 fetch，处理 401 状态以触发前端自动退出登录并重定向
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  const response = await originalFetch(...args);
  if (response.status === 401) {
    const tokenKey = 'code_pipeline_token';
    const shieldTokenKey = 'code_shield_token';
    if (localStorage.getItem(tokenKey) || localStorage.getItem(shieldTokenKey)) {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(shieldTokenKey);
      window.location.reload();
    }
  }
  return response;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/pipeline">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
