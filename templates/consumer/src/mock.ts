// The smallest CSDL JSON metadata and seed that a grid can read.
export const metadata = {
  $Version: "4.01",
  $EntityContainer: "Template.Container",
  $Reference: {
    "https://oasis-tcs.github.io/odata-vocabularies/vocabularies/Org.OData.Core.V1.json": {
      $Include: [{ $Namespace: "Org.OData.Core.V1", $Alias: "Core" }],
    },
  },
  Template: {
    Project: {
      $Kind: "EntityType",
      $Key: ["id"],
      id: { $Type: "Edm.Int32" },
      name: { $Type: "Edm.String", "@Core.Description": "Project name" },
      owner: { $Type: "Edm.String", "@Core.Description": "Owner" },
      state: { $Type: "Edm.String", "@Core.Description": "Status" },
    },
    Container: {
      $Kind: "EntityContainer",
      Projects: { $Collection: true, $Type: "Template.Project" },
    },
  },
};

export const seed = {
  Projects: [
    { id: 1, name: "Onboarding", owner: "Ada", state: "Active" },
    { id: 2, name: "Billing", owner: "Grace", state: "Active" },
    { id: 3, name: "Inventory", owner: "Linus", state: "Paused" },
    { id: 4, name: "Reporting", owner: "Ada", state: "Active" },
    { id: 5, name: "Archive", owner: "Margaret", state: "Done" },
    { id: 6, name: "Support", owner: "Grace", state: "Active" },
    { id: 7, name: "Mobile", owner: "Linus", state: "Active" },
    { id: 8, name: "Website", owner: "Margaret", state: "Paused" },
  ],
};
