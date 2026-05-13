// lib/auth.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Role = "analyst" | "admin";

export interface AuthUser {
  emp_id: string;
  full_name: string;
  employee_name?: string;
  email: string;
  role: Role;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (email: string, role: Role, emp_id: string, full_name: string, employee_name?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "cftip.auth.v2";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw));
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const persist = (u: AuthUser | null) => {
    setUser(u);
    if (u) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  const login = (email: string, role: Role, emp_id: string, full_name: string, employee_name?: string) => {
    const newUser: AuthUser = {
      emp_id,
      full_name,
      employee_name,
      email,
      role,
    };
    persist(newUser);
  };

  const logout = () => {
    persist(null);
    localStorage.removeItem("emp_id");
  };

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}