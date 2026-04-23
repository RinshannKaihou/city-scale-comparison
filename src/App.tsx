import { useCityData } from '@/hooks/useCityData';
import { CitySelector } from '@/components/CitySelector';
import { MapCanvas } from '@/components/MapCanvas';

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

  return (
    <div className="w-screen h-screen bg-neutral-50 flex overflow-hidden">
      <CitySelector
        cities={cities}
        warning={warning}
        onToggleCity={toggleCity}
        onToggleRegion={toggleRegion}
        onReset={resetOffsets}
        onClearAll={clearAll}
      />
      <div className="flex-1 relative">
        <MapCanvas cities={cities} onOffsetChange={setOffset} />
      </div>
    </div>
  );
}

export default App;
