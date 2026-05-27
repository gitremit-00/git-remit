"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoadingScreen from "../../components/LoadingScreen";

export default function Onboarding() {
  const router = useRouter();
  useEffect(() => { router.replace("/login"); }, []);
  return <LoadingScreen />;
}
