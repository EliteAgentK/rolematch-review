import { Document, Packer, Paragraph, HeadingLevel } from "docx";

const p = (t: string) => new Paragraph(t);
const h = (t: string) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 });

/** A clearly fictional candidate used only for tests and demos. */
export async function sampleCv(name = "Jordan Example", extraLine = "") {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    p(name), p("jordan.example@example.test | 011 000 0000 | Johannesburg, South Africa"),
    h("Professional Summary"),
    p("Full-stack developer who builds web applications with React, TypeScript and Node.js and owns features from planning through production."),
    h("Skills"), p("TypeScript, JavaScript, React, Node.js, PostgreSQL, REST APIs, Git, Docker, AWS, Jest"),
    h("Professional Experience"),
    p("Senior Developer, Acme Software (2019-03 - Present)"),
    p("Built React and TypeScript front ends and Node.js REST APIs backed by PostgreSQL."),
    p("Deployed services to AWS using Docker and GitHub Actions CI/CD pipelines."),
    p("Mentored two junior developers and ran weekly code reviews."),
    p("Developer, Bright Apps (2016-01 - 2019-02)"),
    p("Maintained JavaScript web applications and wrote automated tests with Jest."),
    h("Education"), p("BSc Computer Science, University of Example, 2015"),
    h("Projects"), p("Open-source accessibility checker used by several teams outside the company."),
    ...(extraLine ? [p(extraLine)] : []),
  ] }] }));
}

export async function sampleJob() {
  return Packer.toBuffer(new Document({ sections: [{ children: [
    p("Senior Software Developer"), p("Example Corp"),
    p("Location Johannesburg South Africa"), p("Work arrangement Hybrid three days in office"),
    p("Employment type Permanent full time"), p("Department Engineering"),
    h("Role overview"),
    p("Example Corp is looking for a Senior Software Developer to design, build and maintain secure, scalable web applications for our customers."),
    h("Responsibilities"), p("Design and develop production-ready web applications and APIs."), p("Mentor junior and intermediate developers."),
    h("Required experience"),
    p("At least five years of professional software-development experience."),
    p("Strong experience with TypeScript and JavaScript."),
    p("Production experience with React and Node.js."),
    p("Experience with Java and Spring Boot."),
    p("Working knowledge of relational databases, preferably PostgreSQL."),
    p("Strong written and verbal communication skills."),
    h("Preferred experience"), p("Docker and container-based development."), p("Kubernetes in production."),
    h("Education"), p("A relevant degree is preferred but not mandatory."),
  ] }] }));
}
