import { HeroSection } from "@/components/landing/HeroSection";
import { HowItWorksCards } from "@/components/landing/HowItWorksCards";
import { SafetyStrip } from "@/components/landing/SafetyStrip";
import { SemaShell } from "@/components/layout/SemaShell";

export default function HomePage() {
  return (
    <SemaShell landing>
      <main className="relative overflow-hidden">
        <HeroSection />
        <HowItWorksCards />
        <SafetyStrip />
      </main>
    </SemaShell>
  );
}
