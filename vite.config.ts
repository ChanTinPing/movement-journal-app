import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  base: "/movement-journal-app/",
  plugins: [react()],
});
