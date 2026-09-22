'use client';

import React, { useState, useEffect } from 'react';
import { Vehicle } from '@/types';
import { getVehicleProfile, saveVehicleProfile } from '@/lib/vehicleStore';
import { recalculateFromBookOpening } from '@/lib/pageStore';

export default function VehicleProfileForm() {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    getVehicleProfile().then((data) => {
      setVehicle(data);
      setLoading(false);
    });
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    if (!vehicle) return;
    const { name, value } = e.target;
    setVehicle({
      ...vehicle,
      [name]: ['tank_capacity', 'current_odometer', 'current_fuel_level', 'typical_economy_low', 'typical_economy_high'].includes(name)
        ? parseFloat(value) || 0
        : value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vehicle) return;
    // Validate Typical Economy Range
    const low = Number(vehicle.typical_economy_low);
    const high = Number(vehicle.typical_economy_high);
    if (isNaN(low) || isNaN(high) || low < 0.1 || high > 50 || low >= high) {
      setErrorMessage('Typical economy range invalid: require 0.1 ≤ low < high ≤ 50 (e.g. 7.0 – 9.0)');
      return;
    }
    setSaving(true);
    setSuccessMessage('');
    setErrorMessage('');
    try {
      const previous = await getVehicleProfile();
      const updated = await saveVehicleProfile(vehicle);
      setVehicle(updated);
      // If Book Opening (odometer/fuel) changed, recalculate ledger balances forward from earliest Page
      const openingKmChanged = previous.current_odometer !== updated.current_odometer;
      const openingFuelChanged = previous.current_fuel_level !== updated.current_fuel_level;
      if (openingKmChanged || openingFuelChanged) {
        try {
          await recalculateFromBookOpening(updated.current_odometer ?? 0, updated.current_fuel_level ?? 0);
        } catch (err) {
          console.warn('Failed to recalculate pages from Book Opening', err);
        }
      }
      setSuccessMessage('Vehicle profile saved successfully!');
      setTimeout(() => setSuccessMessage(''), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-zinc-500">Loading vehicle profile...</div>;
  }

  if (!vehicle) return null;

  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-zinc-900 shadow-md rounded-xl p-8 border border-zinc-200 dark:border-zinc-800">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">Vehicle Profile & Settings</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Configure vehicle specifications and telemetry parameters.</p>
        </div>
        <span className="px-3 py-1 bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200 rounded-full text-xs font-semibold uppercase tracking-wider">
          {vehicle.vehicle_type}
        </span>
      </div>

      {successMessage && (
        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-lg text-sm font-medium">
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm font-medium">
          {errorMessage}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Brand</label>
            <input
              type="text"
              name="brand"
              value={vehicle.brand}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Model</label>
            <input
              type="text"
              name="model"
              value={vehicle.model}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Vehicle Type</label>
            <select
              name="vehicle_type"
              value={vehicle.vehicle_type}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
            >
              <option value="Double Cab">Double Cab</option>
              <option value="Single Cab">Single Cab</option>
              <option value="Lorry">Lorry</option>
              <option value="SUV">SUV</option>
              <option value="Van">Van</option>
              <option value="Car">Car</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Fuel Type</label>
            <select
              name="fuel_type"
              value={vehicle.fuel_type}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
            >
              <option value="Diesel">Diesel</option>
              <option value="Petrol">Petrol</option>
              <option value="Hybrid">Hybrid</option>
              <option value="Electric">Electric</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Tank Capacity (L)</label>
            <input
              type="number"
              step="0.1"
              name="tank_capacity"
              value={vehicle.tank_capacity}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Book Opening KM (KM)</label>
            <input
              type="number"
              step="1"
              name="current_odometer"
              value={vehicle.current_odometer}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none font-mono"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Integer KM — opening odometer for Book Opening</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Book Opening Fuel (L)</label>
            <input
              type="number"
              step="0.1"
              name="current_fuel_level"
              value={vehicle.current_fuel_level}
              onChange={handleChange}
              required
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none font-mono"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Re-editable after retroactive insertion — recalculates forward</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Registration No</label>
            <input
              type="text"
              name="registration_no"
              value={vehicle.registration_no ?? ''}
              onChange={handleChange}
              placeholder="CAB-1234"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Typical Economy Low (km/L)</label>
            <input
              type="number"
              step="0.1"
              name="typical_economy_low"
              value={vehicle.typical_economy_low ?? 7.0}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">Typical Economy High (km/L)</label>
            <input
              type="number"
              step="0.1"
              name="typical_economy_high"
              value={vehicle.typical_economy_high ?? 9.0}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-lg bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:ring-2 focus:ring-cyan-500 focus:outline-none font-mono"
            />
            <p className="text-[11px] text-zinc-500 mt-1">Green in graph if inside, Amber within 20% margin outside, Red beyond</p>
          </div>
        </div>

        <div className="flex justify-end pt-4">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-100 dark:hover:bg-zinc-200 text-white dark:text-zinc-900 font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Vehicle Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
