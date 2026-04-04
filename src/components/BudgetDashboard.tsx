import { useEffect, useState, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import type { TooltipItem } from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface BudgetRow {
  type: string;
  category: string;
  months: (number | null)[];
  total: number | null;
}

const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const EXPENSE_COLORS = [
  "#1a6b5a", "#4ab8d6", "#7c9a82", "#a8c4ad", "#f0c040",
  "#e07850", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
  "#f97316", "#6366f1", "#14b8a6", "#eab308", "#ef4444",
];

function parseCsv(text: string): BudgetRow[] {
  const lines = text.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Skip header row
  const rows: BudgetRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 3) continue;

    const type = fields[0].replace(/"/g, "").trim();
    const category = fields[1].replace(/"/g, "").trim();
    if (!type || !category) continue;

    const months: (number | null)[] = [];
    for (let m = 2; m < 14 && m < fields.length; m++) {
      const val = fields[m].replace(/"/g, "").trim();
      months.push(val === "" ? null : parseFloat(val) || 0);
    }

    const totalField = fields[14]?.replace(/"/g, "").trim();
    const total = totalField === "" || totalField === undefined ? null : parseFloat(totalField) || 0;

    rows.push({ type, category, months, total });
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

export default function BudgetDashboard() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load available years
  useEffect(() => {
    fetch("/budgets/years.json")
      .then((r) => r.json())
      .then((data: number[]) => {
        const sorted = [...data].sort((a, b) => b - a);
        setYears(sorted);
        setSelectedYear(sorted[0] ?? null);
      })
      .catch(() => setError("Could not load budget data."));
  }, []);

  // Load selected year CSV
  useEffect(() => {
    if (!selectedYear) return;
    setLoading(true);
    setError(null);
    fetch(`/budgets/${selectedYear}.csv`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.text();
      })
      .then((text) => {
        setRows(parseCsv(text));
        setLoading(false);
      })
      .catch(() => {
        setError(`Could not load budget for ${selectedYear}.`);
        setLoading(false);
      });
  }, [selectedYear]);

  const income = useMemo(
    () => rows.filter((r) => r.type === "Income"),
    [rows]
  );
  const expenses = useMemo(
    () => rows.filter((r) => r.type === "Expense" && r.total !== null && r.total > 0),
    [rows]
  );

  const monthlyIncome = useMemo(() => {
    const totals = new Array(12).fill(0);
    income.forEach((r) => r.months.forEach((v, i) => (totals[i] += v ?? 0)));
    return totals;
  }, [income]);

  const monthlyExpenses = useMemo(() => {
    const totals = new Array(12).fill(0);
    expenses.forEach((r) => r.months.forEach((v, i) => (totals[i] += v ?? 0)));
    return totals;
  }, [expenses]);

  const totalIncome = monthlyIncome.reduce((s, v) => s + v, 0);
  const totalExpenses = monthlyExpenses.reduce((s, v) => s + v, 0);
  const netBalance = totalIncome - totalExpenses;

  // --- Charts ---
  const incomeVsExpenseData = {
    labels: MONTH_LABELS,
    datasets: [
      {
        label: "Income",
        data: monthlyIncome,
        backgroundColor: "#1a6b5a",
        borderRadius: 4,
      },
      {
        label: "Expenses",
        data: monthlyExpenses,
        backgroundColor: "#4ab8d6",
        borderRadius: 4,
      },
    ],
  };

  const expenseBreakdownData = {
    labels: expenses.map((r) => r.category),
    datasets: [
      {
        data: expenses.map((r) => r.total ?? 0),
        backgroundColor: expenses.map((_, i) => EXPENSE_COLORS[i % EXPENSE_COLORS.length]),
        borderWidth: 2,
        borderColor: "#fff",
      },
    ],
  };

  const cumulativeData = useMemo(() => {
    let cumIncome = 0;
    let cumExpense = 0;
    const incomeAcc: number[] = [];
    const expenseAcc: number[] = [];
    const netAcc: number[] = [];
    for (let i = 0; i < 12; i++) {
      cumIncome += monthlyIncome[i];
      cumExpense += monthlyExpenses[i];
      incomeAcc.push(cumIncome);
      expenseAcc.push(cumExpense);
      netAcc.push(cumIncome - cumExpense);
    }
    return { incomeAcc, expenseAcc, netAcc };
  }, [monthlyIncome, monthlyExpenses]);

  const cumulativeChartData = {
    labels: MONTH_LABELS,
    datasets: [
      {
        label: "Cumulative Income",
        data: cumulativeData.incomeAcc,
        borderColor: "#1a6b5a",
        backgroundColor: "rgba(26, 107, 90, 0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: "Cumulative Expenses",
        data: cumulativeData.expenseAcc,
        borderColor: "#4ab8d6",
        backgroundColor: "rgba(74, 184, 214, 0.08)",
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: "Net Balance",
        data: cumulativeData.netAcc,
        borderColor: "#f0c040",
        borderDash: [5, 5],
        fill: false,
        tension: 0.3,
        pointRadius: 3,
      },
    ],
  };

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" as const },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"bar">) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw as number)}`,
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: (v: string | number) => formatCurrency(v as number),
        },
      },
    },
  };

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" as const },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"line">) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw as number)}`,
        },
      },
    },
    scales: {
      y: {
        ticks: {
          callback: (v: string | number) => formatCurrency(v as number),
        },
      },
    },
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "right" as const,
        labels: { boxWidth: 14, padding: 12, font: { size: 12 } },
      },
      tooltip: {
        callbacks: {
          label: (ctx: TooltipItem<"doughnut">) => {
            const val = ctx.raw as number;
            const pct = totalExpenses > 0 ? ((val / totalExpenses) * 100).toFixed(1) : "0";
            return `${ctx.label}: ${formatCurrency(val)} (${pct}%)`;
          },
        },
      },
    },
  };

  if (error) {
    return (
      <div className="text-center py-12 text-slate-500">{error}</div>
    );
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-slate-500">Loading budget data...</div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Year selector */}
      {years.length > 1 && (
        <div className="flex items-center gap-3">
          <label htmlFor="year-select" className="text-sm font-semibold text-gray-700">
            Fiscal Year:
          </label>
          <select
            id="year-select"
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#1a6b5a] focus:border-transparent"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-6 border border-gray-200 text-center">
          <p className="text-sm text-gray-500 mb-1">Total Income</p>
          <p className="text-2xl font-bold text-[#1a6b5a]">{formatCurrency(totalIncome)}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-200 text-center">
          <p className="text-sm text-gray-500 mb-1">Total Expenses</p>
          <p className="text-2xl font-bold text-[#4ab8d6]">{formatCurrency(totalExpenses)}</p>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-200 text-center">
          <p className="text-sm text-gray-500 mb-1">Net Balance</p>
          <p className={`text-2xl font-bold ${netBalance >= 0 ? "text-[#1a6b5a]" : "text-red-500"}`}>
            {formatCurrency(netBalance)}
          </p>
        </div>
      </div>

      {/* Monthly Income vs Expenses */}
      <div className="bg-white rounded-xl p-6 border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Monthly Income vs Expenses</h3>
        <div className="h-72">
          <Bar data={incomeVsExpenseData} options={barOptions} />
        </div>
      </div>

      {/* Expense Breakdown + Cumulative */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Expense Breakdown</h3>
          <div className="h-72">
            <Doughnut data={expenseBreakdownData} options={doughnutOptions} />
          </div>
        </div>
        <div className="bg-white rounded-xl p-6 border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Cumulative Cash Flow</h3>
          <div className="h-72">
            <Line data={cumulativeChartData} options={lineOptions} />
          </div>
        </div>
      </div>

      {/* Detailed table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <h3 className="text-lg font-semibold text-gray-800 p-6 pb-0">Monthly Detail</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left p-3 pl-6 font-semibold text-gray-600 sticky left-0 bg-white">Category</th>
                {MONTH_LABELS.map((m) => (
                  <th key={m} className="text-right p-3 font-semibold text-gray-600 whitespace-nowrap">{m}</th>
                ))}
                <th className="text-right p-3 pr-6 font-semibold text-gray-600">Total</th>
              </tr>
            </thead>
            <tbody>
              {income.length > 0 && (
                <>
                  <tr>
                    <td colSpan={14} className="px-6 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-[#1a6b5a]">
                      Income
                    </td>
                  </tr>
                  {income.map((r) => (
                    <tr key={`i-${r.category}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="p-3 pl-6 sticky left-0 bg-white text-gray-700">{r.category}</td>
                      {r.months.map((v, i) => (
                        <td key={i} className="text-right p-3 text-gray-600 whitespace-nowrap">
                          {v !== null ? formatCurrency(v) : "—"}
                        </td>
                      ))}
                      <td className="text-right p-3 pr-6 font-semibold text-gray-800">
                        {r.total !== null ? formatCurrency(r.total) : "—"}
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {expenses.length > 0 && (
                <>
                  <tr>
                    <td colSpan={14} className="px-6 pt-4 pb-1 text-xs font-bold uppercase tracking-wider text-[#4ab8d6]">
                      Expenses
                    </td>
                  </tr>
                  {expenses.map((r) => (
                    <tr key={`e-${r.category}`} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="p-3 pl-6 sticky left-0 bg-white text-gray-700">{r.category}</td>
                      {r.months.map((v, i) => (
                        <td key={i} className="text-right p-3 text-gray-600 whitespace-nowrap">
                          {v !== null ? formatCurrency(v) : "—"}
                        </td>
                      ))}
                      <td className="text-right p-3 pr-6 font-semibold text-gray-800">
                        {r.total !== null ? formatCurrency(r.total) : "—"}
                      </td>
                    </tr>
                  ))}
                </>
              )}
              {/* Totals row */}
              <tr className="border-t-2 border-gray-300 bg-gray-50 font-semibold">
                <td className="p-3 pl-6 sticky left-0 bg-gray-50 text-gray-800">Net</td>
                {monthlyIncome.map((inc, i) => {
                  const net = inc - monthlyExpenses[i];
                  return (
                    <td key={i} className={`text-right p-3 whitespace-nowrap ${net >= 0 ? "text-[#1a6b5a]" : "text-red-500"}`}>
                      {formatCurrency(net)}
                    </td>
                  );
                })}
                <td className={`text-right p-3 pr-6 ${netBalance >= 0 ? "text-[#1a6b5a]" : "text-red-500"}`}>
                  {formatCurrency(netBalance)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
