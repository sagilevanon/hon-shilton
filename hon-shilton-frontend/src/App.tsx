import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import NetworkGraphPage from './Pages/NetworkGraph';
import { Toaster } from '@/components/ui/toaster';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-gray-50">
        <main className="container mx-auto py-6">
          <Routes>
            <Route path="/" element={<NetworkGraphPage />} />
          </Routes>
        </main>
        <Toaster />
      </div>
    </Router>
  );
}

export default App;
