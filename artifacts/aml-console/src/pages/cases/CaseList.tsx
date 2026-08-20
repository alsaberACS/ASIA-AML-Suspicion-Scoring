import { useState } from 'react';
import { useListCases, useCreateCase, useDeleteCase, Case } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { Plus, Trash2, FolderSearch, AlertTriangle } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { toast } from 'sonner';

export default function CaseList() {
  const { data: cases, isLoading } = useListCases();
  const createCase = useCreateCase();
  const deleteCase = useDeleteCase();
  const [, setLocation] = useLocation();

  const [createOpen, setCreateOpen] = useState(false);
  const [formData, setFormData] = useState({ subjectName: '', subjectReference: '' });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.subjectName) return;
    
    createCase.mutate({ data: formData }, {
      onSuccess: (newCase) => {
        toast.success('Case created');
        setCreateOpen(false);
        setLocation(`/cases/${newCase.id}`);
      },
      onError: (err) => {
        toast.error('Failed to create case');
      }
    });
  };

  const handleDelete = (e: React.MouseEvent, id: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (confirm('Are you sure you want to permanently delete this case?')) {
      deleteCase.mutate({ caseId: id }, {
        onSuccess: () => {
          toast.success('Case deleted');
        }
      });
    }
  };

  const getBandColor = (band: string | undefined) => {
    switch (band) {
      case 'Critical': return 'text-destructive border-destructive/30 bg-destructive/10';
      case 'High': return 'text-orange-500 border-orange-500/30 bg-orange-500/10';
      case 'Elevated': return 'text-amber-500 border-amber-500/30 bg-amber-500/10';
      case 'Moderate': return 'text-primary border-primary/30 bg-primary/10';
      case 'Low': return 'text-emerald-500 border-emerald-500/30 bg-emerald-500/10';
      default: return 'text-muted-foreground border-border bg-muted';
    }
  };

  return (
    <div className="p-8 space-y-6 flex flex-col h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Case Registry</h1>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            Manage subject investigations and view scoring summaries
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="rounded-sm font-mono text-xs">
          <Plus className="h-4 w-4 mr-2" />
          New Case
        </Button>
      </div>

      <div className="flex-1 bg-card border border-border rounded-sm shadow-sm overflow-hidden flex flex-col">
        {isLoading ? (
          <div className="p-8 flex justify-center text-primary">
            <span className="animate-spin h-6 w-6 border-2 border-background/20 border-t-primary rounded-full" />
          </div>
        ) : cases && cases.length > 0 ? (
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="bg-background/50 sticky top-0 z-10 backdrop-blur-sm border-b border-border">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-mono uppercase text-xs">Subject Name</TableHead>
                  <TableHead className="font-mono uppercase text-xs">Ref ID</TableHead>
                  <TableHead className="font-mono uppercase text-xs">Banks</TableHead>
                  <TableHead className="font-mono uppercase text-xs">Files</TableHead>
                  <TableHead className="font-mono uppercase text-xs">Txns</TableHead>
                  <TableHead className="font-mono uppercase text-xs">Latest Run</TableHead>
                  <TableHead className="font-mono uppercase text-xs">Updated</TableHead>
                  <TableHead className="w-12 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c: Case) => (
                  <TableRow 
                    key={c.id} 
                    className="cursor-pointer hover:bg-muted/50 transition-colors border-b border-border/50"
                    onClick={() => setLocation(`/cases/${c.id}`)}
                  >
                    <TableCell className="font-medium">{c.subjectName}</TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {c.subjectReference || '—'}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{c.bankCount}</TableCell>
                    <TableCell className="font-mono text-xs">{c.fileCount}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {(c.txnCount > 0 ? c.txnCount : 0).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {c.latestRun ? (
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono border uppercase tracking-wider ${getBandColor(c.latestRun.band)}`}>
                            {c.latestRun.band}
                          </span>
                          <span className="font-mono text-xs text-primary">
                            {(c.latestRun.probability * 100).toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground font-mono">NO RUN</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {format(new Date(c.updatedAt), 'dd MMM yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => handleDelete(e, c.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
            <FolderSearch className="h-12 w-12 mb-4 opacity-20" />
            <h3 className="text-lg font-medium text-foreground mb-1">No cases found</h3>
            <p className="text-sm">Create a new case to start an investigation.</p>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md cyber-panel border-primary/20">
          <DialogHeader>
            <DialogTitle className="font-mono uppercase tracking-widest text-primary text-sm flex items-center gap-2">
              <Plus className="h-4 w-4" /> Initialize Case
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="subjectName" className="font-mono text-xs text-muted-foreground">Subject Name <span className="text-destructive">*</span></Label>
              <Input
                id="subjectName"
                value={formData.subjectName}
                onChange={e => setFormData({ ...formData, subjectName: e.target.value })}
                placeholder="e.g. John Doe"
                className="font-mono bg-background border-border focus-visible:ring-primary"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="subjectReference" className="font-mono text-xs text-muted-foreground">Reference ID (Optional)</Label>
              <Input
                id="subjectReference"
                value={formData.subjectReference}
                onChange={e => setFormData({ ...formData, subjectReference: e.target.value })}
                placeholder="e.g. CIF-9284"
                className="font-mono bg-background border-border focus-visible:ring-primary"
              />
            </div>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="rounded-sm font-mono text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={createCase.isPending || !formData.subjectName} className="rounded-sm font-mono text-xs">
                {createCase.isPending ? 'Creating...' : 'Initialize'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}