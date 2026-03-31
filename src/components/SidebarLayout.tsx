"use client";

import { useState } from "react";
import SidebarNav from "./SidebarNav";

export default function SidebarLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      <SidebarNav collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <div
        className="flex-1 min-h-screen transition-all duration-300"
        style={{ marginLeft: collapsed ? 60 : 210 }}
      >
        {children}
      </div>
    </>
  );
}
