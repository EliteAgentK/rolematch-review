// One colour per standard department (server/src/jobReader.ts, JOB_DEPARTMENTS), the same wherever a department is shown, so a recruiter learns it once
// (owner, 10 Nov 2026: "all different colours ... colours related to different fields"). Chosen to stay apart from one another on dark and light pages.
const DEPARTMENT_COLOURS: Record<string, string> = {
  "Executive leadership": "#F5B83D",
  "Technology": "#3AA8D1",
  "Data and analytics": "#8E7CFF",
  "Finance": "#2BD47D",
  "Risk and compliance": "#FE6D73",
  "Legal": "#94A3B8",
  "Human resources": "#F472B6",
  "Sales and marketing": "#F58220",
  "Customer service": "#17C3B2",
  "Operations": "#FFCB77",
  "Project and programme management": "#6C8CFF",
  "Supply chain and logistics": "#C9A227",
  "Engineering": "#5FB4FF",
  "Mining and resources": "#D9773A",
  "Science and research": "#9BD33C",
  "Healthcare": "#FF8A80",
  "Education": "#FFD600",
  "Administration": "#A5B4FC",
  "Other": "#9CA3AF",
};
export const departmentColour = (name: string) => DEPARTMENT_COLOURS[name] ?? "#9CA3AF";
