import { useState } from 'react';
import { Menu } from 'lucide-react';
import { Toaster } from 'sonner';
import { useCityData } from '@/hooks/useCityData';
import { CitySelector } from '@/components/CitySelector';
import { MapCanvas } from '@/components/MapCanvas';
import { Drawer, DrawerContent, DrawerTrigger } from '@/components/ui/drawer';

function App() {
  const {
    cities,
    loading,
    error,
    warning,
    toggleCity,
    toggleRegion,
    setOffset,
    resetOffsets,
    clearAll,
  } = useCityData();
  const [drawerOpen, setDrawerOpen] = useState(false);

  if (loading) {
    return (
      <div className="w-screen h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-neutral-400 font-mono text-sm animate-pulse">
          Loading city data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-screen h-screen bg-neutral-50 flex items-center justify-center">
        <div className="text-red-500 font-mono text-sm">
          Error: {error}
        </div>
      </div>
    );
  }

  const selector = (
    <CitySelector
      cities={cities}
      warning={warning}
      onToggleCity={toggleCity}
      onToggleRegion={toggleRegion}
      onReset={resetOffsets}
      onClearAll={clearAll}
    />
  );

  return (
    <div className="w-screen h-screen bg-neutral-50 flex overflow-hidden">
      {/* Desktop sidebar (>= md) */}
      <div className="hidden md:flex">{selector}</div>

      <div className="flex-1 relative">
        <MapCanvas cities={cities} onOffsetChange={setOffset} />

        {/* Mobile drawer trigger (< md) */}
        <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
          <DrawerTrigger asChild>
            <button
              className="md:hidden absolute top-4 left-4 z-10 bg-white/90 backdrop-blur-sm border border-black/10 rounded-md px-3 py-2 shadow-sm flex items-center gap-2 text-sm text-neutral-700"
              aria-label="Open city selector"
            >
              <Menu className="w-4 h-4" />
              <span className="font-mono text-xs">
                {cities.filter((c) => c.visible).length} 城市
              </span>
            </button>
          </DrawerTrigger>
          <DrawerContent className="md:hidden">
            {selector}
          </DrawerContent>
        </Drawer>
      </div>

      <Toaster position="bottom-center" closeButton richColors />
    </div>
  );
}

export default App;
