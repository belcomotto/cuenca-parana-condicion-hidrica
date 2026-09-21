import './style.css';
import { loadData } from './shared.js';
import { initMap, resizeMap } from './mapView.js';
import { renderDashboard } from './dashboard.js';

async function main() {
  const data = await loadData();

  initMap(data);

  const dashboardEl = document.getElementById('dashboard-view');
  let dashboardRendered = false;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const tab = btn.dataset.tab;
      document.getElementById('map-view').classList.toggle('active', tab === 'map');
      document.getElementById('dashboard-view').classList.toggle('active', tab === 'dashboard');

      if (tab === 'dashboard' && !dashboardRendered) {
        renderDashboard(dashboardEl, data);
        dashboardRendered = true;
      }
      if (tab === 'map') {
        resizeMap();
      }
    });
  });
}

main();
