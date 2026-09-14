"use client";

import React, { useRef } from 'react';
import { useBatchStore } from '@/lib/store/useBatchStore';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { toPng } from 'html-to-image';
import jsPDF from 'jspdf';

const COLORS = { healthy: '#10b981', mold: '#f59e0b', rotten: '#f43f5e', sprouted: '#a855f7' };

export default function BatchDashboard() {
  const { currentBatch, finishBatch } = useBatchStore();
  const receiptRef = useRef<HTMLDivElement>(null);

  if (currentBatch.length === 0) return null;

  const gradeCounts = { A: 0, URS: 0, Reject: 0, Manual: 0 };
  const defectCounts = { healthy: 0, mold: 0, rotten: 0, sprouted: 0 };
  const diameterBuckets = { '<35mm': 0, '35-50mm': 0, '50-70mm': 0, '>70mm': 0 };
  let totalOnions = 0;

  currentBatch.forEach(img => {
    img.onions.forEach(onion => {
      totalOnions++;
      if (onion.grading?.grade === 'Grade A') gradeCounts.A++;
      else if (onion.grading?.grade === 'Grade URS') gradeCounts.URS++;
      else if (onion.grading?.grade === 'Reject') gradeCounts.Reject++;
      else gradeCounts.Manual++;

      defectCounts[onion.classification.label]++;

      const d = onion.dimensions?.diameterMm || 0;
      if (d > 0 && d < 35) diameterBuckets['<35mm']++;
      else if (d >= 35 && d <= 50) diameterBuckets['35-50mm']++;
      else if (d > 50 && d <= 70) diameterBuckets['50-70mm']++;
      else if (d > 70) diameterBuckets['>70mm']++;
    });
  });

  const pieData = Object.entries(defectCounts).filter(([_, count]) => count > 0).map(([name, value]) => ({ name, value }));
  const barData = Object.entries(diameterBuckets).map(([name, value]) => ({ name, value }));

  const handleGenerateReceipt = async () => {
    if (!receiptRef.current) return;
    receiptRef.current.style.backgroundColor = '#ffffff';
    receiptRef.current.style.color = '#000000';
    try {
      const dataUrl = await toPng(receiptRef.current, { cacheBust: true, pixelRatio: 2 });
      receiptRef.current.style.backgroundColor = '';
      receiptRef.current.style.color = '';
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`OnionVision_Receipt_${Date.now()}.pdf`);
      await finishBatch();
    } catch (err) {
      console.error("PDF Generation failed:", err);
      receiptRef.current.style.backgroundColor = '';
      receiptRef.current.style.color = '';
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto p-4 md:p-6 space-y-6 mt-8 border-t border-neutral-800 pt-8">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-neutral-100">Batch Analytics</h2>
        <button onClick={handleGenerateReceipt} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition">
          Generate PDF & Finalize Batch
        </button>
      </div>

      <div ref={receiptRef} className="p-6 bg-neutral-950 border border-neutral-800 rounded-xl space-y-8">
        <div className="flex justify-between items-end border-b border-neutral-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-emerald-500">NCCF Procurement Receipt</h1>
            <p className="text-sm text-neutral-400">Date: {new Date().toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-neutral-400">Total Scanned</p>
            <p className="text-3xl font-bold text-neutral-100">{totalOnions}</p>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-emerald-900/20 border border-emerald-900/50 rounded-lg">
            <p className="text-xs uppercase tracking-wider text-emerald-400">Grade A</p>
            <p className="text-2xl font-bold text-neutral-100">{gradeCounts.A}</p>
          </div>
          <div className="p-4 bg-amber-900/20 border border-amber-900/50 rounded-lg">
            <p className="text-xs uppercase tracking-wider text-amber-400">Grade URS</p>
            <p className="text-2xl font-bold text-neutral-100">{gradeCounts.URS}</p>
          </div>
          <div className="p-4 bg-rose-900/20 border border-rose-900/50 rounded-lg">
            <p className="text-xs uppercase tracking-wider text-rose-400">Rejected</p>
            <p className="text-2xl font-bold text-neutral-100">{gradeCounts.Reject}</p>
          </div>
          <div className="p-4 bg-neutral-800/50 border border-neutral-700 rounded-lg">
            <p className="text-xs uppercase tracking-wider text-neutral-400">Review</p>
            <p className="text-2xl font-bold text-neutral-100">{gradeCounts.Manual}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 h-64">
          <div className="flex flex-col items-center">
            <h3 className="text-sm font-semibold text-neutral-400 mb-2">Quality Distribution</h3>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {pieData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[entry.name as keyof typeof COLORS]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: '#262626' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col items-center">
            <h3 className="text-sm font-semibold text-neutral-400 mb-2">Size Profile (mm)</h3>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <XAxis dataKey="name" stroke="#525252" fontSize={12} />
                <YAxis stroke="#525252" fontSize={12} allowDecimals={false} />
                <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: '#262626' }} cursor={{ fill: '#262626' }} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}