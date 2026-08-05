export type DashboardRequest = {
  assignmentId: string;
  reference: string;
  title: string;
  category: string;
  area: string;
  distance: string;
  received: string;
  due: string;
  urgency: "urgent" | "normal";
  itemCount: number;
  attachmentCount: number;
  status: "New" | "Viewed" | "Accepted";
};

export type DashboardData = {
  companyName: string;
  contactName: string;
  initials: string;
  unreadNotificationCount: number;
  subscription: { plan: string; status: string; renewal: string };
  stats: { newRequests: number; openQuotes: number; wonThisMonth: number; responseRate: number };
  performance: { responseTime: string; winRate: string; monthValue: string };
  requests: DashboardRequest[];
  recent: Array<{ reference: string; title: string; value: string; status: "Won" | "Submitted" | "Lost"; date: string }>;
};

export const demoDashboard: DashboardData = {
  companyName: "Northstar Steel",
  contactName: "Sarah Mitchell",
  initials: "SM",
  unreadNotificationCount: 2,
  subscription: { plan: "Growth", status: "Active", renewal: "20 Aug 2026" },
  stats: { newRequests: 4, openQuotes: 7, wonThisMonth: 3, responseRate: 94 },
  performance: { responseTime: "1h 42m", winRate: "28%", monthValue: "£42.8k" },
  requests: [
    { assignmentId: "assignment_demo_0842", reference: "BA-2026-0842", title: "Fabricated access platform & stairs", category: "Fabricated steelwork", area: "Solihull · B90", distance: "14 miles", received: "2 hours ago", due: "5h 18m", urgency: "urgent", itemCount: 3, attachmentCount: 4, status: "New" },
    { assignmentId: "assignment_demo_0837", reference: "BA-2026-0837", title: "UC beams for mezzanine extension", category: "Structural steel", area: "Coventry · CV7", distance: "21 miles", received: "Yesterday, 15:42", due: "22h 04m", urgency: "normal", itemCount: 1, attachmentCount: 2, status: "Viewed" },
    { assignmentId: "assignment_demo_0831", reference: "BA-2026-0831", title: "Balustrade package for apartment cores", category: "Access systems", area: "Wolverhampton · WV10", distance: "18 miles", received: "Yesterday, 11:06", due: "1d 4h", urgency: "normal", itemCount: 5, attachmentCount: 7, status: "Accepted" },
  ],
  recent: [
    { reference: "BA-2026-0781", title: "Warehouse edge protection", value: "£8,420", status: "Won", date: "27 Jul" },
    { reference: "BA-2026-0794", title: "Portal frame steel package", value: "£31,860", status: "Submitted", date: "29 Jul" },
    { reference: "BA-2026-0755", title: "Plant room access stairs", value: "£6,940", status: "Lost", date: "21 Jul" },
  ],
};

export const demoRequest = {
  ...demoDashboard.requests[0],
  summary: "Supply and fabricate a galvanised maintenance access platform and stair flight to the issued drawings. The structure will provide safe access to a new conveyor line within an operational warehouse.",
  delivery: "Solihull, West Midlands · B90",
  requestedBy: "Verified WhatsApp customer",
  customerNotice: "Direct customer details are protected. Bridge AI will coordinate contact until your quotation is selected.",
  items: [
    { description: "Galvanised access platform", specification: "Approx. 5.2m × 2.4m, complete to drawing A-104", quantity: "1 each" },
    { description: "Stair flight with handrails", specification: "38° pitch, 1,100mm clear width", quantity: "1 each" },
    { description: "Site delivery", specification: "B90 delivery address, forklift available", quantity: "1 lot" },
  ],
  attachments: [
    { name: "GA-access-platform-A104.pdf", meta: "PDF · 2.4 MB", type: "Drawing" },
    { name: "site-opening-01.jpg", meta: "JPG · 1.8 MB", type: "Photo" },
    { name: "site-opening-02.jpg", meta: "JPG · 2.1 MB", type: "Photo" },
    { name: "finish-schedule.pdf", meta: "PDF · 428 KB", type: "Specification" },
  ],
};
