function buildChartUrl(symbol, history = []) {
  const safeHistory = Array.isArray(history) ? history.slice(-48) : [];
  const labels = safeHistory.map((_, i) => `${i + 1}`);
  const prices = safeHistory.map((p) => Number(p.price || 0));

  const min = prices.length ? Math.min(...prices) : 0;
  const max = prices.length ? Math.max(...prices) : 100;
  const rising = prices.length > 1 ? prices[prices.length - 1] >= prices[0] : true;

  const config = {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: symbol,
          data: prices,
          borderColor: rising ? "#2ecc71" : "#e74c3c",
          backgroundColor: "rgba(255,255,255,0.04)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.25,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      devicePixelRatio: 2,
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `${symbol} Price History`,
          color: "#ffffff",
          font: { size: 16 },
        },
      },
      scales: {
        x: {
          ticks: { color: "#cfd8dc" },
          grid: { color: "rgba(255,255,255,0.08)" },
        },
        y: {
          ticks: { color: "#cfd8dc" },
          grid: { color: "rgba(255,255,255,0.08)" },
          suggestedMin: Math.max(0, min * 0.97),
          suggestedMax: max * 1.03,
        },
      },
      layout: {
        padding: 12,
      },
    },
  };

  return `https://quickchart.io/chart?width=900&height=420&backgroundColor=%23101720&c=${encodeURIComponent(
    JSON.stringify(config)
  )}`;
}

module.exports = {
  buildChartUrl,
};