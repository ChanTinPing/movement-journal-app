import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.chantinping.movementjournal",
  appName: "运动日记",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
