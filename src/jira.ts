export type JiraClient = {
  createIssue: (
    projectKey: string,
    summary: string,
    description: string,
    labels: string[],
  ) => Promise<JiraCreatedIssue>;
};

export type JiraCreatedIssue = {
  key: string;
  self: string;
};

export const createJiraClient = (
  host: string,
  email: string,
  apiToken: string,
): JiraClient => {
  const baseUrl = host.startsWith("https://")
    ? host.replace(/\/+$/, "")
    : `https://${host.replace(/\/+$/, "")}`;

  const credentials = Buffer.from(`${email}:${apiToken}`).toString("base64");

  const createIssue = async (
    projectKey: string,
    summary: string,
    description: string,
    labels: string[],
  ): Promise<JiraCreatedIssue> => {
    const body = {
      fields: {
        project: { key: projectKey },
        summary,
        description,
        issuetype: { name: "Task" },
        labels,
      },
    };

    const response = await fetch(`${baseUrl}/rest/api/2/issue`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "(no body)");
      throw new Error(
        `Jira API error ${response.status}: ${text}`,
      );
    }

    const data = (await response.json()) as { key: string; self: string };
    return { key: data.key, self: data.self };
  };

  return { createIssue };
};
