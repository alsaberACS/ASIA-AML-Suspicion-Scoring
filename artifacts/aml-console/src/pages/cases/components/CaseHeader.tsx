import { useState, useEffect } from 'react';
import { Case, useUpdateCase } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Pencil, User, Briefcase, Building2, MapPin, AlignLeft, Hash } from 'lucide-react';
import { toast } from 'sonner';

export default function CaseHeader({ caseData }: { caseData: Case }) {
  const [editOpen, setEditOpen] = useState(false);
  const updateCase = useUpdateCase();
  
  const [formData, setFormData] = useState({
    subjectName: caseData.subjectName,
    subjectReference: caseData.subjectReference || '',
    declaredOccupation: caseData.declaredOccupation || '',
    declaredMonthlyIncomeKwd: caseData.declaredMonthlyIncomeKwd?.toString() || '',
    declaredBusinessActivity: caseData.declaredBusinessActivity || '',
    expectedCountries: caseData.expectedCountries?.join(', ') || '',
    notes: caseData.notes || '',
  });

  // Sync form data if caseData changes
  useEffect(() => {
    setFormData({
      subjectName: caseData.subjectName,
      subjectReference: caseData.subjectReference || '',
      declaredOccupation: caseData.declaredOccupation || '',
      declaredMonthlyIncomeKwd: caseData.declaredMonthlyIncomeKwd?.toString() || '',
      declaredBusinessActivity: caseData.declaredBusinessActivity || '',
      expectedCountries: caseData.expectedCountries?.join(', ') || '',
      notes: caseData.notes || '',
    });
  }, [caseData]);

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.subjectName) return;

    updateCase.mutate({
      caseId: caseData.id,
      data: {
        subjectName: formData.subjectName,
        subjectReference: formData.subjectReference || null,
        declaredOccupation: formData.declaredOccupation || null,
        declaredMonthlyIncomeKwd: formData.declaredMonthlyIncomeKwd ? Number(formData.declaredMonthlyIncomeKwd) : null,
        declaredBusinessActivity: formData.declaredBusinessActivity || null,
        expectedCountries: formData.expectedCountries ? formData.expectedCountries.split(',').map(s => s.trim()).filter(Boolean) : [],
        notes: formData.notes || null
      }
    }, {
      onSuccess: () => {
        toast.success('Subject profile updated');
        setEditOpen(false);
      },
      onError: () => toast.error('Failed to update profile')
    });
  };

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'draft': return 'bg-muted text-muted-foreground border-border';
      case 'ready': return 'bg-primary/20 text-primary border-primary/30';
      case 'analyzing': return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
      case 'scored': return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30';
      default: return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <Card className="bg-card border-border rounded-sm shadow-sm">
      <CardContent className="p-6">
        <div className="flex flex-col md:flex-row justify-between items-start gap-4">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded bg-primary/10 border border-primary/20 flex items-center justify-center">
                <User className="h-6 w-6 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold tracking-tight">{caseData.subjectName}</h1>
                  <Badge variant="outline" className={`font-mono text-[10px] uppercase tracking-wider ${getStatusColor(caseData.status)}`}>
                    {caseData.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground font-mono mt-1">
                  {caseData.subjectReference && (
                    <span className="flex items-center gap-1.5 text-primary/80">
                      <Hash className="h-3 w-3" /> {caseData.subjectReference}
                    </span>
                  )}
                  <span>ID: {caseData.id}</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3 pt-2">
              <div className="space-y-1">
                <div className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider gap-1.5">
                  <Briefcase className="h-3 w-3" /> Occupation
                </div>
                <div className="text-sm font-medium">{caseData.declaredOccupation || '—'}</div>
              </div>
              
              <div className="space-y-1">
                <div className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider gap-1.5">
                  <Building2 className="h-3 w-3" /> Business Activity
                </div>
                <div className="text-sm font-medium">{caseData.declaredBusinessActivity || '—'}</div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider gap-1.5">
                  <span className="font-serif italic text-xs leading-none">KWD</span> Declared Income
                </div>
                <div className="text-sm font-medium font-mono">
                  {caseData.declaredMonthlyIncomeKwd ? `${caseData.declaredMonthlyIncomeKwd.toLocaleString()} /mo` : '—'}
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider gap-1.5">
                  <MapPin className="h-3 w-3" /> Expected Countries
                </div>
                <div className="text-sm font-medium flex flex-wrap gap-1">
                  {caseData.expectedCountries && caseData.expectedCountries.length > 0 ? (
                    caseData.expectedCountries.map(c => (
                      <span key={c} className="bg-secondary/50 text-secondary-foreground text-xs px-1.5 py-0.5 rounded-sm border border-secondary">
                        {c}
                      </span>
                    ))
                  ) : '—'}
                </div>
              </div>
            </div>

            {caseData.notes && (
              <div className="pt-2 border-t border-border/50">
                <div className="flex items-center text-xs font-mono text-muted-foreground uppercase tracking-wider gap-1.5 mb-1.5">
                  <AlignLeft className="h-3 w-3" /> Analyst Notes
                </div>
                <p className="text-sm text-muted-foreground bg-muted/30 p-3 rounded-sm border border-border/50 whitespace-pre-wrap">
                  {caseData.notes}
                </p>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)} className="rounded-sm font-mono text-xs border-primary/30 text-primary hover:bg-primary/10">
            <Pencil className="h-3 w-3 mr-2" />
            Edit Profile
          </Button>
        </div>
      </CardContent>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-xl cyber-panel border-primary/20">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest text-primary text-sm flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Subject Profile
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="subjectName" className="font-mono text-xs text-muted-foreground">Subject Name <span className="text-destructive">*</span></Label>
                <Input
                  id="subjectName"
                  value={formData.subjectName}
                  onChange={e => setFormData({ ...formData, subjectName: e.target.value })}
                  className="font-mono bg-background border-border focus-visible:ring-primary"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="subjectReference" className="font-mono text-xs text-muted-foreground">Reference ID</Label>
                <Input
                  id="subjectReference"
                  value={formData.subjectReference}
                  onChange={e => setFormData({ ...formData, subjectReference: e.target.value })}
                  className="font-mono bg-background border-border focus-visible:ring-primary"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="declaredOccupation" className="font-mono text-xs text-muted-foreground">Occupation</Label>
                <Input
                  id="declaredOccupation"
                  value={formData.declaredOccupation}
                  onChange={e => setFormData({ ...formData, declaredOccupation: e.target.value })}
                  className="font-mono bg-background border-border focus-visible:ring-primary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="declaredMonthlyIncomeKwd" className="font-mono text-xs text-muted-foreground">Monthly Income (KWD)</Label>
                <Input
                  id="declaredMonthlyIncomeKwd"
                  type="number"
                  value={formData.declaredMonthlyIncomeKwd}
                  onChange={e => setFormData({ ...formData, declaredMonthlyIncomeKwd: e.target.value })}
                  className="font-mono bg-background border-border focus-visible:ring-primary"
                />
              </div>
              
              <div className="col-span-2 space-y-2">
                <Label htmlFor="declaredBusinessActivity" className="font-mono text-xs text-muted-foreground">Business Activity</Label>
                <Input
                  id="declaredBusinessActivity"
                  value={formData.declaredBusinessActivity}
                  onChange={e => setFormData({ ...formData, declaredBusinessActivity: e.target.value })}
                  className="font-mono bg-background border-border focus-visible:ring-primary"
                />
              </div>

              <div className="col-span-2 space-y-2">
                <Label htmlFor="expectedCountries" className="font-mono text-xs text-muted-foreground">Expected Countries (comma-separated)</Label>
                <Input
                  id="expectedCountries"
                  value={formData.expectedCountries}
                  onChange={e => setFormData({ ...formData, expectedCountries: e.target.value })}
                  placeholder="e.g. Kuwait, UAE, UK"
                  className="font-mono bg-background border-border focus-visible:ring-primary"
                />
              </div>

              <div className="col-span-2 space-y-2">
                <Label htmlFor="notes" className="font-mono text-xs text-muted-foreground">Analyst Notes</Label>
                <Textarea
                  id="notes"
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="font-mono bg-background border-border focus-visible:ring-primary min-h-[100px]"
                />
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} className="rounded-sm font-mono text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={updateCase.isPending || !formData.subjectName} className="rounded-sm font-mono text-xs">
                {updateCase.isPending ? 'Saving...' : 'Save Profile'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}