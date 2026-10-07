'use client';
import { useState } from 'react';
import { AppHeader, Tabs } from '@/components/ui';
import { StatusStrip } from '@/components/StatusStrip';
import { BenchmarkTab } from '@/components/BenchmarkTab';
import { ProbeTab } from '@/components/ProbeTab';
import { StorageTab } from '@/components/StorageTab';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('benchmark');

  const tabs = [
    { id: 'benchmark', label: 'Benchmark' },
    { id: 'probe', label: 'Live Probe' },
    { id: 'storage', label: 'Storage' },
  ];

  return (
    <>
      <AppHeader title="Dashboard" />
      <main className="w-full px-4 py-4 sm:px-6 lg:px-8">
        <StatusStrip />
        
        <div className="mb-4">
          <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
        </div>

        {activeTab === 'benchmark' && <BenchmarkTab />}
        {activeTab === 'probe' && <ProbeTab />}
        {activeTab === 'storage' && <StorageTab />}
      </main>
    </>
  );
}
