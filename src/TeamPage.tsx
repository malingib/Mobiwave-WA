import { useEffect, useState } from "react";
import { Check, X, Plus, Trash2, Edit, User, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";
import { MarketingFooter, MarketingNav, SectionHeading } from "./components/MarketingChrome";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "editor";
  avatar_url?: string;
  created_at: string;
  last_sign_in_at?: string;
};

type TeamPlan = {
  max_team_members: number;
  current_team_members: number;
  can_add_members: boolean;
};

export default function TeamPage() {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [plan, setPlan] = useState<TeamPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor">("editor");
  const [inviteLoading, setInviteLoading] = useState(false);

  useEffect(() => {
    fetchTeamData();
  }, []);

  const fetchTeamData = async () => {
    try {
      // Fetch team members
      const { data: members, error: membersError } = await (supabase ? supabase
        .from("team_members")
        .select("*")
        .eq("tenant_id", "current_tenant_id") : { data: [], error: null }); // Replace with actual tenant ID

      if (membersError) throw membersError;
      setTeamMembers(members || []);

      // Fetch plan information
      const { data: planData, error: planError } = await (supabase ? supabase
        .from("platform_billing_tiers")
        .select("max_team_members")
        .eq("slug", "current_plan_slug") : { data: [], error: null }); // Replace with actual plan slug

      if (planError) throw planError;
      
      const maxTeamMembers = planData && planData.length > 0 ? planData[0].max_team_members : 0;
      
      setPlan({
        max_team_members: maxTeamMembers,
        current_team_members: members.length,
        can_add_members: members.length < maxTeamMembers
      });
    } catch (err) {
      console.error("Error fetching team data:", err);
      setError("Failed to load team information");
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteLoading(true);

    try {
      const { error } = await (supabase ? supabase
        .from("team_members")
        .insert({
          tenant_id: "current_tenant_id", // Replace with actual tenant ID
          email: inviteEmail,
          role: inviteRole,
          invited_by: "current_user_id" // Replace with actual user ID
        }) : { error: null });

      if (error) throw error;

      // Reset form and refresh data
      setInviteEmail("");
      setInviteRole("editor");
      setShowInviteForm(false);
      fetchTeamData();
    } catch (err) {
      console.error("Error inviting team member:", err);
      setError("Failed to invite team member");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!confirm("Are you sure you want to remove this team member?")) return;

    try {
      const { error } = await (supabase ? supabase
        .from("team_members")
        .delete()
        .eq("id", memberId) : { error: null });

      if (error) throw error;

      fetchTeamData();
    } catch (err) {
      console.error("Error removing team member:", err);
      setError("Failed to remove team member");
    }
  };

  const getRoleColor = (role: string) => {
    return role === "admin" ? "bg-red-100 text-red-800" : "bg-blue-100 text-blue-800";
  };

  const getRoleText = (role: string) => {
    return role === "admin" ? "Admin" : "Editor";
  };

  return (
    <div className="flex min-h-screen flex-col bg-surface">
      <MarketingNav />

      <main className="flex-grow">
        <div className="container mx-auto px-4 py-12 md:py-16 lg:py-20">
          {/* Hero Section */}
          <SectionHeading
            kicker="Team Management"
            title="Manage your team members and permissions"
            description="Add collaborators to your workspace with different roles and access levels."
            align="center"
          />

          {/* Team Overview */}
          <div className="mt-12 grid grid-cols-1 gap-8 lg:grid-cols-3">
            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">Team Members</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                {teamMembers.length} of {plan?.max_team_members || "Unlimited"} members
              </p>
              <div className="mt-4 h-2 w-full rounded-full bg-ink-100">
                <div 
                  className="h-2 rounded-full bg-brand-600" 
                  style={{ width: `${Math.min(100, (teamMembers.length / (plan?.max_team_members || 1)) * 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">Admin Access</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                {teamMembers.filter(m => m.role === "admin").length} admin(s)
              </p>
              <p className="text-[12px] text-ink-500 mt-1">
                Admins can manage billing and team settings
              </p>
            </div>

            <div className="rounded-xl border border-ink-200 bg-surface p-6">
              <h3 className="font-bold text-ink-800">Editor Access</h3>
              <p className="mt-2 text-[13.5px] text-ink-600">
                {teamMembers.filter(m => m.role === "editor").length} editor(s)
              </p>
              <p className="text-[12px] text-ink-500 mt-1">
                Editors can create and manage messages
              </p>
            </div>
          </div>

          {/* Team Members List */}
          <div className="mt-12">
            <div className="flex items-center justify-between">
              <h3 className="text-[18px] font-bold text-ink-800">Team Members</h3>
              {plan?.can_add_members && (
                <button
                  onClick={() => setShowInviteForm(true)}
                  className="flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-500"
                >
                  <Plus size={16} />
                  Add Member
                </button>
              )}
            </div>

            {/* Invite Form */}
            {showInviteForm && (
              <div className="mt-6 rounded-xl border border-ink-200 bg-surface p-6">
                <h4 className="font-bold text-ink-800">Invite Team Member</h4>
                <form onSubmit={handleInvite} className="mt-4 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      required
                      className="w-full rounded-lg border border-ink-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
                      placeholder="team@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink-700 mb-1">
                      Role
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as "admin" | "editor")}
                      className="w-full rounded-lg border border-ink-300 px-3 py-2 focus:border-brand-500 focus:outline-none"
                    >
                      <option value="editor">Editor - Can create and manage messages</option>
                      <option value="admin">Admin - Can manage billing and team settings</option>
                    </select>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      disabled={inviteLoading}
                      className="flex-1 rounded-lg bg-brand-600 px-4 py-2 text-white hover:bg-brand-500 disabled:opacity-50"
                    >
                      {inviteLoading ? "Inviting..." : "Send Invitation"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowInviteForm(false)}
                      className="flex-1 rounded-lg border border-ink-300 px-4 py-2 text-ink-700 hover:bg-ink-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Members List */}
            <div className="mt-6 grid grid-cols-1 gap-4">
              {loading ? (
                <div className="text-center py-8">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent"></div>
                  <p className="mt-2 text-sm text-ink-500">Loading team members...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-600">{error}</p>
                </div>
              ) : teamMembers.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-ink-500">No team members yet. Add your first team member to get started.</p>
                </div>
              ) : (
                teamMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between rounded-xl border border-ink-200 bg-surface p-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-brand-100 flex items-center justify-center">
                        {member.avatar_url ? (
                          <img src={member.avatar_url} alt={member.name} className="h-10 w-10 rounded-full" />
                        ) : (
                          <User size={20} className="text-brand-600" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-medium text-ink-800">{member.name}</h4>
                        <p className="text-sm text-ink-500">{member.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getRoleColor(member.role)}`}>
                        {getRoleText(member.role)}
                      </span>
                      {member.role !== "admin" && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Role Permissions */}
          <div className="mt-16">
            <SectionHeading
              kicker="Role Permissions"
              title="Understand what each role can do in your workspace"
              align="center"
            />

            <div className="mt-8 grid grid-cols-1 gap-8 md:grid-cols-2">
              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 flex items-center gap-2">
                  <ShieldCheck size={20} className="text-red-600" />
                  Admin
                </h3>
                <ul className="mt-4 space-y-2">
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    Manage billing and payments
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    Add and remove team members
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    Change workspace settings
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    View and export all data
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    Manage integrations
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-ink-200 bg-surface p-6">
                <h3 className="font-bold text-ink-800 flex items-center gap-2">
                  <Edit size={20} className="text-blue-600" />
                  Editor
                </h3>
                <ul className="mt-4 space-y-2">
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    Create and manage messages
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    View analytics and reports
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <Check size={16} className="text-green-600 mt-0.5" />
                    Manage contacts
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <X size={16} className="text-red-600 mt-0.5" />
                    Cannot manage billing
                  </li>
                  <li className="flex items-start gap-2 text-sm">
                    <X size={16} className="text-red-600 mt-0.5" />
                    Cannot add/remove team members
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      <MarketingFooter />
    </div>
  );
}