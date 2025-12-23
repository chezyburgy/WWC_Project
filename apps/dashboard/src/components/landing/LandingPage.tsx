import Header from './Header'
import HeroContent from './HeroContent'
import ShaderBackground from './ShaderBackground'
import Features from './Features'

export default function LandingPage() {
  return (
    <ShaderBackground>
      <div className="min-h-screen flex flex-col">
        <Header />
        <div className="flex-1 relative">
          <HeroContent />
        </div>
      </div>
      <Features />
    </ShaderBackground>
  )
}
