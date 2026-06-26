import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import NetworkGraphPage from './Pages/NetworkGraph';
import ReviewPage from './Pages/Review';
import { Toaster } from '@/components/ui/toaster';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<NetworkGraphPage />} />
        <Route path="/review" element={<ReviewPage />} />
      </Routes>
      <Toaster />
    </Router>
  );
}

export default App;
